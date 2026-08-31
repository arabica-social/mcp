import { createServer, request } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import { beginOAuthLogin } from "../../src/auth/login.js";
// Logins started through the provider (startLogin) do not receive an `open`
// option, so they would otherwise invoke the real OS browser opener with the
// test's fake authorization URL. Keep the browser out of unit tests.
vi.mock("../../src/auth/browser.js", () => ({
  openBrowser: vi.fn(async () => false),
}));
import { JsonStore } from "../../src/auth/session-store.js";
import { createOAuthClient, OAuthAuthProvider } from "../../src/auth/client.js";
import { ToolFailure } from "../../src/tools/errors.js";
import { lexiconManifest } from "../../src/generated/lexicons.js";

describe("OAuth login", () => {
  it("starts the loopback callback before opening the browser", async () => {
    let opened = "";
    let received: URLSearchParams | undefined;
    const client = {
      authorize: async () => new URL("https://issuer.example/authorize"),
      callback: async (params: URLSearchParams) => {
        received = params;
        return { session: { did: "did:plc:test" } };
      },
    };

    const attempt = await beginOAuthLogin(client, "alice.example", {
      port: 0,
      open: (url) => {
        opened = url;
        return true;
      },
    });

    expect(opened).toBe(attempt.authorizationUrl);
    expect(attempt.browserOpened).toBe(true);

    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: attempt.callbackPort,
          path: "/callback?code=test-code&state=test-state",
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });

    await expect(attempt.completion).resolves.toEqual({ did: "did:plc:test" });
    expect(received?.get("code")).toBe("test-code");
    expect(received?.get("state")).toBe("test-state");
  });

  it("times out an abandoned login and releases the callback port", async () => {
    const client = {
      authorize: async () => new URL("https://issuer.example/authorize"),
      callback: async () => {
        throw new Error("unused");
      },
    };

    const attempt = await beginOAuthLogin(client, "alice.example", {
      port: 0,
      timeout: 25,
      open: () => true,
    });

    await expect(attempt.completion).rejects.toThrow(/timed out/i);
    // The listener must not keep 127.0.0.1:<port> bound after the attempt.
    await expect(
      eventuallyListen(attempt.callbackPort),
    ).resolves.toBeUndefined();
  });
});

describe("createOAuthClient", () => {
  it("builds loopback metadata via the SDK helper and collection-derived scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arabica-oauth-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createOAuthClient(
      join(dir, "state.json"),
      join(dir, "session.json"),
    );
    warn.mockRestore();

    const expectedScope = [
      "atproto",
      ...lexiconManifest.collections.map((c) => `repo:${c}`),
    ].join(" ");

    expect(client.clientMetadata.scope).toBe(expectedScope);
    expect(client.clientMetadata.redirect_uris).toEqual([
      "http://127.0.0.1:43127/callback",
    ]);
    expect(client.clientMetadata.client_id).toBe(
      `http://localhost?redirect_uri=${encodeURIComponent("http://127.0.0.1:43127/callback")}&scope=${encodeURIComponent(expectedScope)}`,
    );
    expect(client.clientMetadata).toMatchObject({
      client_name: "Arabica MCP (development)",
      client_uri: "http://localhost",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      dpop_bound_access_tokens: true,
    });
    // The SDK constructor validates the metadata; the request lock must be
    // wired up so the client never warns about missing lock support.
    expect(warn).not.toHaveBeenCalledWith(
      "No lock mechanism provided. Credentials might get revoked.",
    );
  });
});

describe("JsonStore", () => {
  it("round-trips values and clears the backing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arabica-store-"));
    const path = join(dir, "store.json");
    const store = new JsonStore<{ did: string }>(path);

    await store.set("alice", { did: "did:plc:alice" });
    expect(await store.get("alice")).toEqual({ did: "did:plc:alice" });
    expect(await store.get("missing")).toBeUndefined();

    await store.del("alice");
    expect(await store.get("alice")).toBeUndefined();

    await store.set("alice", { did: "did:plc:alice" });
    await store.clear();
    expect(await store.get("alice")).toBeUndefined();
  });

  it("survives concurrent deletes without colliding on the temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arabica-store-"));
    const path = join(dir, "store.json");
    const store = new JsonStore<number>(path);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.set(`key-${i}`, i)),
    );
    await expect(
      Promise.all(Array.from({ length: 20 }, (_, i) => store.del(`key-${i}`))),
    ).resolves.toBeDefined();
  });
});

describe("OAuthAuthProvider", () => {
  it("reports an authenticated status from the stored did", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arabica-oauth-"));
    const client = createOAuthClient(
      join(dir, "state.json"),
      join(dir, "session.json"),
    );
    const provider = new OAuthAuthProvider(client, "did:plc:known");
    expect(provider.getLoginStatus()).toEqual({
      status: "authenticated",
      did: "did:plc:known",
    });
  });

  it("surfaces the sanitized login failure message instead of a constant", async () => {
    const client = {
      authorize: async () => {
        throw new Error(
          "issuer rejected login: access_token=abc123&refresh_token=def456",
        );
      },
      callback: async () => {
        throw new Error("unused");
      },
    } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "");

    await expect(provider.startLogin("alice.example")).rejects.toThrow(
      "issuer rejected login",
    );
    expect(provider.getLoginStatus()).toEqual({
      status: "failed",
      message:
        "issuer rejected login: access_token=[redacted]&refresh_token=[redacted]",
    });
  });

  it("restores the session once across repeated getSession calls", async () => {
    const restore = vi.fn(async () => ({
      did: "did:plc:known",
      fetchHandler: async () => new Response(),
      signOut: async () => {},
    }));
    const client = { restore } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "did:plc:known");

    const [first, second] = await Promise.all([
      provider.getSession(),
      provider.getSession(),
    ]);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.did).toBe("did:plc:known");
  });

  it("retries restore after a failed getSession instead of caching the error", async () => {
    const restore = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({
        did: "did:plc:known",
        fetchHandler: async () => new Response(),
        signOut: async () => {},
      });
    const client = { restore } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "did:plc:known");

    await expect(provider.getSession()).rejects.toThrow("not_authenticated");
    await expect(provider.getSession()).resolves.toMatchObject({
      did: "did:plc:known",
    });
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("drops the cached session after signOut", async () => {
    const restore = vi.fn(async () => ({
      did: "did:plc:known",
      fetchHandler: async () => new Response(),
      signOut: async () => {},
    }));
    const client = { restore } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "did:plc:known");

    const session = await provider.getSession();
    await session.signOut?.();
    await provider.getSession();

    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("lets a later login with a different handle supersede a pending attempt", async () => {
    const client = {
      authorize: async (handle: string) =>
        new URL(
          `https://issuer.example/authorize?handle=${encodeURIComponent(handle)}`,
        ),
      callback: async () => {
        throw new Error("unused");
      },
    } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "");

    const first = await provider.startLogin("alice.example");
    expect(provider.getLoginStatus()).toEqual({ status: "pending" });

    const second = await provider.startLogin("bob.example");
    // The stale attempt failed and its callback listener closed, so a fresh
    // listener could bind the default loopback port.
    expect(second).not.toBe(first);
    await expect(first.completion).rejects.toThrow(/superseded/i);
    expect(provider.getLoginStatus()).toEqual({ status: "pending" });

    // Provider-driven logins must not reach the real OS browser; only the
    // mock opener sees the authorization URLs.
    const { openBrowser } = await import("../../src/auth/browser.js");
    expect(openBrowser).toHaveBeenCalledWith(
      "https://issuer.example/authorize?handle=alice.example",
    );
    expect(openBrowser).toHaveBeenCalledWith(
      "https://issuer.example/authorize?handle=bob.example",
    );
    expect(first.browserOpened).toBe(false);
    expect(second.browserOpened).toBe(false);

    // A repeat login with the same handle reuses the live attempt.
    expect(await provider.startLogin("bob.example")).toBe(second);
  });

  it("fails fast when already authenticated instead of opening a browser tab", async () => {
    const restore = vi.fn(async () => ({
      did: "did:plc:known",
      fetchHandler: async () => new Response(),
      signOut: async () => {},
    }));
    const authorize = vi.fn(
      async () => new URL("https://issuer.example/authorize"),
    );
    const client = {
      restore,
      authorize,
      callback: async () => {
        throw new Error("unused");
      },
    } as unknown as NodeOAuthClient;
    const provider = new OAuthAuthProvider(client, "did:plc:known");

    const { openBrowser } = await import("../../src/auth/browser.js");
    vi.mocked(openBrowser).mockClear();

    await expect(provider.startLogin("alice.example")).rejects.toBeInstanceOf(
      ToolFailure,
    );
    await expect(provider.startLogin("alice.example")).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(provider.startLogin("alice.example")).rejects.toThrow(
      /Already logged in as did:plc:known/,
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });
});

/** Prove a loopback port is free by binding a fresh listener to it. */
function listenOn(port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}

/** Retry listenOn while the just-closed callback server finishes unbinding. */
async function eventuallyListen(port: number, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      await listenOn(port);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`port ${port} never became available`);
}
