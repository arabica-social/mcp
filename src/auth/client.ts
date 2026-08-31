import {
  atprotoLoopbackClientMetadata,
  NodeOAuthClient,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedState,
  type NodeSavedStateStore,
} from "@atproto/oauth-client-node";
import { paths } from "../config.js";
import { lexiconManifest } from "../generated/lexicons.js";
import { JsonStore } from "./session-store.js";
import { beginOAuthLogin, type OAuthLoginAttempt } from "./login.js";
import { ToolFailure } from "../tools/errors.js";
export type AuthSession = {
  did: string;
  fetchHandler: (path: string, init?: RequestInit) => Promise<Response>;
  signOut?: () => Promise<void>;
};
export type LoginStatus =
  | { status: "authenticated"; did: string }
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "unauthenticated" };
export interface AuthProvider {
  getSession(): Promise<AuthSession>;
  startLogin?(handle: string): Promise<OAuthLoginAttempt>;
  getLoginStatus?(): LoginStatus;
}

/**
 * Default AT Proto handle → DID resolver. It is Bluesky's app-view, which only
 * indexes accounts whose PDS is the Bluesky app-view; users on other PDSs need
 * a resolver for their own PDS via `ARABICA_HANDLE_RESOLVER` or the
 * `handleResolver` option.
 */
export const DEFAULT_HANDLE_RESOLVER = "https://bsky.social";

export type CreateOAuthClientOptions = {
  /**
   * App-view endpoint used to resolve login handles to DIDs. Defaults to
   * `ARABICA_HANDLE_RESOLVER`, then `DEFAULT_HANDLE_RESOLVER`.
   */
  handleResolver?: string;
};

export function createOAuthClient(
  statePath = paths().oauthState,
  sessionPath = paths().oauthSession,
  options: CreateOAuthClientOptions = {},
) {
  const stateStore: NodeSavedStateStore = new JsonStore<NodeSavedState>(
    statePath,
  );
  const sessionStore: NodeSavedSessionStore = new JsonStore<NodeSavedSession>(
    sessionPath,
  );
  const scope = [
    "atproto",
    ...lexiconManifest.collections.map((c) => `repo:${c}`),
  ].join(" ");
  const redirect = "http://127.0.0.1:43127/callback";
  const clientMetadata = {
    ...atprotoLoopbackClientMetadata(
      `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(scope)}`,
    ),
    client_name: "Arabica MCP (development)",
    client_uri: "http://localhost",
  };
  const handleResolver =
    options.handleResolver ??
    process.env.ARABICA_HANDLE_RESOLVER ??
    DEFAULT_HANDLE_RESOLVER;
  return new NodeOAuthClient({
    clientMetadata,
    responseMode: "query",
    requestLock: requestLocalLock,
    stateStore,
    sessionStore,
    handleResolver,
  });
}
export class OAuthAuthProvider implements AuthProvider {
  private pending?: Promise<{ did: string }>;
  private pendingAttempt?: OAuthLoginAttempt;
  private starting?: Promise<OAuthLoginAttempt>;
  private loginFailure?: string;
  /** Handle of the account that most recently completed a login here. */
  private loginHandle?: string;
  /**
   * Restoring a session may refresh tokens and set up DPoP, so it is a network
   * operation. Keep the restored session (or the in-flight restore promise)
   * around for the lifetime of the process instead of redoing it on every tool
   * call. Keyed by DID so a login completing under a new DID invalidates it.
   */
  private sessionCache?: { did: string; session: Promise<AuthSession> };

  constructor(
    private readonly client: NodeOAuthClient,
    private did: string,
    private readonly saveDid?: (did: string) => Promise<void>,
  ) {}

  async startLogin(handle: string): Promise<OAuthLoginAttempt> {
    // If a session is already usable there is nothing to log in for: fail
    // fast with a typed error instead of opening another browser tab. A
    // stale *pending* attempt only exists before a session completes, so the
    // supersede path below is unaffected.
    let sessionUsable = false;
    try {
      await this.getSession();
      sessionUsable = true;
    } catch {
      // No usable session; a fresh login is required.
    }
    if (sessionUsable)
      throw new ToolFailure(
        "invalid_state",
        `Already logged in as ${this.loginHandle ?? this.did}. Log out first to switch accounts.`,
      );

    const existing = this.pendingAttempt;
    if (existing) {
      if (existing.handle === handle) return existing;
      // A later login supersedes a stale pending attempt: fail it and release
      // its loopback callback port so the new login can bind it.
      existing.cancel();
      this.pending = undefined;
      this.pendingAttempt = undefined;
    } else if (this.starting) {
      // A start is still in flight (handle resolution, listener setup). Wait
      // for it to settle rather than racing two listeners on the same port.
      try {
        await this.starting;
      } catch {
        // The in-flight start failed on its own; fall through to a new start.
      }
      const settled = this.pendingAttempt;
      if (settled) {
        if (settled.handle === handle) return settled;
        settled.cancel();
        this.pending = undefined;
        this.pendingAttempt = undefined;
      }
    }

    this.loginFailure = undefined;
    const startup = (async () => {
      let attempt: OAuthLoginAttempt;
      try {
        attempt = await beginOAuthLogin(this.client, handle);
      } catch (e) {
        this.loginFailure =
          e instanceof Error ? sanitizeLoginError(e.message) : "Login failed";
        throw e;
      }
      const completion = attempt.completion
        .then(async ({ did }) => {
          this.did = did;
          this.loginHandle = attempt.handle;
          this.sessionCache = undefined;
          await this.saveDid?.(did);
          return { did };
        })
        .catch((e) => {
          // Only the current attempt reports a failure; a superseded attempt
          // must not clobber the newer attempt's status.
          if (this.pendingAttempt === attempt) {
            this.loginFailure =
              e instanceof Error
                ? sanitizeLoginError(e.message)
                : "Login failed";
          }
          throw e;
        })
        .finally(() => {
          if (this.pendingAttempt === attempt) {
            this.pending = undefined;
            this.pendingAttempt = undefined;
          }
        });
      attempt.completion = completion;
      this.pending = completion;
      this.pendingAttempt = attempt;
      // Attach a rejection handler immediately. MCP starts this operation in
      // the background, so its failure must not become an unhandled rejection.
      void this.pending.catch(() => {});
      return this.pendingAttempt;
    })();
    this.starting = startup;
    try {
      return await startup;
    } finally {
      if (this.starting === startup) this.starting = undefined;
    }
  }

  getLoginStatus(): LoginStatus {
    if (this.pending) return { status: "pending" };
    if (this.did) return { status: "authenticated", did: this.did };
    if (this.loginFailure)
      return { status: "failed", message: this.loginFailure };
    return { status: "unauthenticated" };
  }

  async getSession() {
    const did = this.did;
    const cached = this.sessionCache;
    if (cached && cached.did === did) return cached.session;

    const session = this.restoreSession(did).catch((e) => {
      // A failed restore (network blip, lost session) must not be cached.
      if (this.sessionCache?.did === did) this.sessionCache = undefined;
      throw e;
    });
    this.sessionCache = { did, session };
    return session;
  }

  private async restoreSession(did: string): Promise<AuthSession> {
    try {
      const s = await this.client.restore(did, "auto");
      return {
        did: String(s.did),
        fetchHandler: s.fetchHandler.bind(s),
        signOut: async () => {
          await s.signOut();
          // The session no longer exists after sign-out.
          if (this.sessionCache?.did === did) this.sessionCache = undefined;
        },
      };
    } catch {
      throw new Error("not_authenticated");
    }
  }
}

/** Strip token-like material from an OAuth error message before surfacing it. */
function sanitizeLoginError(message: string): string {
  return message
    .replace(
      /(access_token|refresh_token|id_token|code)=[^&\s)']+/gi,
      "$1=[redacted]",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
      "[JWT redacted]",
    )
    .slice(0, 1000);
}
