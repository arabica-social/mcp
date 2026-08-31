import { createServer } from "node:http";
import { openBrowser } from "./browser.js";

export const OAUTH_CALLBACK_PORT = 43127;
export const OAUTH_CALLBACK_HOST = "127.0.0.1";
/** An abandoned login fails and releases the callback port after this deadline. */
export const OAUTH_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export type OAuthLoginAttempt = {
  handle: string;
  authorizationUrl: string;
  browserOpened: boolean;
  callbackPort: number;
  completion: Promise<{ did: string }>;
  /** Fail the attempt early and close its loopback callback listener. */
  cancel: () => void;
};

type OAuthClient = {
  authorize(handle: string): Promise<URL>;
  callback(params: URLSearchParams): Promise<{ session: { did: string } }>;
};

/** Start a loopback OAuth login without blocking on browser consent. */
export async function beginOAuthLogin(
  client: OAuthClient,
  handle: string,
  options: {
    open?: (url: string) => boolean | Promise<boolean>;
    port?: number;
    host?: string;
    timeout?: number;
  } = {},
): Promise<OAuthLoginAttempt> {
  const url = await client.authorize(handle);
  const host = options.host ?? OAUTH_CALLBACK_HOST;
  const port = options.port ?? OAUTH_CALLBACK_PORT;
  const timeout = options.timeout ?? OAUTH_LOGIN_TIMEOUT_MS;
  const open = options.open ?? openBrowser;

  const callback = await listenForCallback(host, port, timeout);
  const completion = callback.params
    .then(async (params) => {
      const result = await client.callback(params);
      return { did: String(result.session.did) };
    })
    .finally(() => callback.close());

  let browserOpened = false;
  try {
    browserOpened = await open(url.toString());
  } catch {
    // The URL remains available to the caller as a manual fallback.
  }

  return {
    handle,
    authorizationUrl: url.toString(),
    browserOpened,
    callbackPort: callback.port,
    completion,
    cancel: callback.cancel,
  };
}

async function listenForCallback(
  host: string,
  port: number,
  timeoutMs: number,
) {
  let server!: ReturnType<typeof createServer>;
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  let rejectParams!: (reason: unknown) => void;
  const params = new Promise<URLSearchParams>((resolve, reject) => {
    rejectParams = reject;
    server = createServer((req, res) => {
      if (
        !req.url ||
        new URL(req.url, `http://${host}`).pathname !== "/callback"
      )
        return;
      const url = new URL(req.url, `http://${host}`);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("Authorization complete. You may close this window.");
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(url.searchParams);
    });
    server.on("error", reject);
    server.listen(port, host);
  });
  // Startup errors are also delivered to the callback promise; attach a
  // handler so a failed listener never creates an unhandled rejection.
  void params.catch(() => {});

  // Do not open the browser until the loopback listener is accepting requests.
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (e) {
    if (server.listening) server.close();
    throw e;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("OAuth callback listener did not start.");
  }

  // The browser may never be reached or the user may abandon consent. Fail
  // the attempt and free the callback port so a later login can start cleanly
  // instead of holding 127.0.0.1:<port> until process exit.
  const fail = (e: Error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (server.listening) server.close();
    rejectParams(e);
  };
  const cancel = () =>
    fail(new Error("OAuth login superseded by a newer login attempt"));
  const timeoutLabel =
    timeoutMs < 60_000
      ? `${Math.round(timeoutMs / 1000)} seconds`
      : `${Math.round(timeoutMs / 60_000)} minute${timeoutMs >= 120_000 ? "s" : ""}`;
  timer = setTimeout(
    () =>
      fail(
        new Error(
          `OAuth login timed out after ${timeoutLabel}; the authorization URL is no longer valid. Start login again.`,
        ),
      ),
    timeoutMs,
  );
  timer.unref();

  return {
    params,
    port: address.port,
    close: () => server.close(),
    cancel,
  };
}
