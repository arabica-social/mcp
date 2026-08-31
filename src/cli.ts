#!/usr/bin/env node
import { readFile, writeFile, unlink } from "node:fs/promises";
import { paths } from "./config.js";
import { JsonStore } from "./auth/session-store.js";
import { createOAuthClient, OAuthAuthProvider } from "./auth/client.js";
import { OAuthPdsRepository } from "./pds/oauth-repository.js";
import { IdempotencyStore } from "./state/idempotency.js";
import { serve } from "./server.js";
const p = paths();
const clientId = "arabica-mcp-development";
async function config() {
  try {
    return JSON.parse(await readFile(p.config, "utf8")) as { did: string };
  } catch {
    return undefined;
  }
}
async function saveConfig(v: unknown) {
  await writeFile(p.config, JSON.stringify(v, null, 2), { mode: 0o600 });
}
async function login(handle?: string) {
  if (!handle) {
    console.error("Usage: arabica-mcp login <handle>");
    process.exitCode = 2;
    return;
  }
  const client = createOAuthClient(p.oauthState, p.oauthSession);
  const auth = new OAuthAuthProvider(client, "", async (did) =>
    saveConfig({ did }),
  );
  const attempt = await auth.startLogin(handle);
  console.error(
    `${attempt.browserOpened ? "Opened" : "Open"} this URL to authorize Arabica MCP:\n${attempt.authorizationUrl}`,
  );
  const result = await attempt.completion;
  console.error(`Authenticated as ${result.did}.`);
}
async function status() {
  const c = await config();
  if (!c) {
    console.log("Not authenticated. Run `arabica-mcp login <handle>`.");
    return;
  }
  try {
    const client = createOAuthClient(p.oauthState, p.oauthSession);
    const s = await client.restore(c.did, "auto");
    console.log(`Authenticated as ${s.did}.`);
  } catch {
    console.log("Session unavailable. Run `arabica-mcp login <handle>`.");
  }
}
async function logout() {
  const c = await config();
  if (c)
    try {
      await createOAuthClient(p.oauthState, p.oauthSession).revoke(c.did);
    } catch {}
  await Promise.all([
    new JsonStore(p.oauthState).clear(),
    new JsonStore(p.oauthSession).clear(),
    unlink(p.config).catch(() => {}),
  ]);
  console.error("Logged out.");
}
async function runServe() {
  const c = await config();
  const client = createOAuthClient(p.oauthState, p.oauthSession);
  const auth = new OAuthAuthProvider(client, c?.did ?? "", async (did) =>
    saveConfig({ did }),
  );
  const deps: any = {
    auth,
    pds: (s: any) => new OAuthPdsRepository(s),
    idem: new IdempotencyStore(p.idempotency),
    clientId,
  };
  await serve(deps);
}
const [command, arg] = process.argv.slice(2);
try {
  if (command === "login") await login(arg);
  else if (command === "status") await status();
  else if (command === "logout") await logout();
  else if (command === "serve") await runServe();
  else {
    console.error("Usage: arabica-mcp <login|status|logout|serve>");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "Command failed");
  process.exitCode = 1;
}
