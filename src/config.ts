import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
export const APP_NAME = "arabica-mcp";
export function dataDir(env = process.env) {
  const base = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const dir = join(base, APP_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {}
  return dir;
}
export const paths = (env = process.env) => {
  const d = dataDir(env);
  return {
    root: d,
    oauthState: join(d, "oauth-state.json"),
    oauthSession: join(d, "oauth-session.json"),
    idempotency: join(d, "idempotency.sqlite"),
    config: join(d, "config.json"),
  };
};
