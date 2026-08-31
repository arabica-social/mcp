import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import * as TID from "@atcute/tid";
import { isRecordKey } from "@atcute/lexicons/syntax";
import { ToolFailure } from "../tools/errors.js";
export type MutationKey = {
  clientId: string;
  did: string;
  tool: string;
  requestId: string;
};
export type MutationRow = {
  key: string;
  collection: string;
  rkey: string;
  status: "pending" | "complete";
  result?: unknown;
  payloadHash?: string;
};
/** Deterministic JSON serialization: object keys sorted at every level. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
/**
 * A row's payload identity: the record, the collection it targets, and the tool
 * that wrote it. Updates also bind the rkey they write, so reusing a requestId
 * for a different record is a conflict instead of a silent replay. Creates
 * leave the rkey out: it is generated fresh per reservation, and replaying an
 * idempotent create must match the row made by the first attempt.
 */
function payloadHash(
  tool: string,
  collection: string,
  record: unknown,
  rkey?: string,
) {
  const identity: Record<string, unknown> = { tool, collection, record };
  if (rkey !== undefined) identity.rkey = rkey;
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export class IdempotencyStore {
  private db: any;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const DatabaseSync = createRequire(import.meta.url)(
      "node:sqlite",
    ).DatabaseSync;
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
    } catch {}
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS mutations (k TEXT PRIMARY KEY, collection TEXT NOT NULL, rkey TEXT NOT NULL, status TEXT NOT NULL, result TEXT, payload_hash TEXT, created_at TEXT NOT NULL);`,
    );
    // Migrate databases created before payload hashes existed. Always succeeds
    // for fresh databases (the column already exists).
    try {
      this.db.exec(`ALTER TABLE mutations ADD COLUMN payload_hash TEXT`);
    } catch {
      /* column already present */
    }
    // Completed entries are only needed long enough for retries to be
    // deduplicated; anything older than 30 days is safe to drop.
    const cutoff = new Date(Date.now() - PRUNE_AGE_MS).toISOString();
    try {
      this.db.exec(
        `DELETE FROM mutations WHERE status='complete' AND created_at < '${cutoff}'`,
      );
    } catch {
      /* a locked database must not break startup */
    }
  }
  private key(k: MutationKey) {
    return [k.clientId, k.did, k.tool, k.requestId]
      .map((x) => encodeURIComponent(x))
      .join("|");
  }
  private toRow(old: any): MutationRow {
    return {
      ...old,
      payloadHash: old.payload_hash ?? undefined,
      result: old.result ? JSON.parse(old.result) : undefined,
    };
  }
  /**
   * Reserves a requestId for a mutation. The record (plus collection, tool, and
   * — for updates — rkey) is hashed and stored with the row; reusing a
   * requestId with different input is a conflict instead of silently returning
   * someone else's result.
   */
  reserve(
    k: MutationKey,
    collection: string,
    record: unknown,
    requestedRkey?: string,
  ): MutationRow {
    const key = this.key(k);
    const hash = payloadHash(k.tool, collection, record, requestedRkey);
    const old = this.db.prepare("SELECT * FROM mutations WHERE k=?").get(key);
    if (old) {
      if (old.payload_hash !== hash)
        throw new ToolFailure(
          "conflict",
          "requestId reused with different input",
        );
      return this.toRow(old);
    }
    const rkey = requestedRkey ?? TID.now();
    if (!isRecordKey(rkey))
      throw new ToolFailure(
        "invalid_input",
        "invalid record key: expected a valid AT record key",
      );
    try {
      this.db
        .prepare(
          "INSERT INTO mutations(k,collection,rkey,status,payload_hash,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(key, collection, rkey, "pending", hash, new Date().toISOString());
    } catch (e: any) {
      const race = this.db
        .prepare("SELECT * FROM mutations WHERE k=?")
        .get(key);
      if (race) {
        if (race.payload_hash !== hash)
          throw new ToolFailure(
            "conflict",
            "requestId reused with different input",
          );
        return this.toRow(race);
      }
      throw e;
    }
    return { key, collection, rkey, status: "pending", payloadHash: hash };
  }
  complete(k: MutationKey, result: unknown) {
    this.db
      .prepare("UPDATE mutations SET status=?,result=? WHERE k=?")
      .run("complete", JSON.stringify(result), this.key(k));
  }
}
