import type { AuthSession } from "../auth/client.js";
import type { PdsClient, RecordMeta } from "../pds/repository.js";
import type { IdempotencyStore, MutationKey } from "../state/idempotency.js";
import { mapError } from "./errors.js";
/** Minimum dependency surface the mutation helpers need. Deps satisfies this structurally. */
export type MutationDeps = {
  pds: (session: AuthSession) => PdsClient;
  idem: IdempotencyStore;
};
/** Shape returned to callers for a created/updated/existing record. */
export const meta = (x: RecordMeta) => ({
  uri: x.uri,
  cid: x.cid,
  rkey: x.rkey,
  record: x.value,
});
/**
 * Idempotent create: reserve a requestId, return the already-committed result
 * on replay, or getRecord-then-createRecord to recover from a response that
 * committed on the PDS but was lost on the wire.
 */
export async function idempotentCreate(
  deps: MutationDeps,
  s: AuthSession,
  key: MutationKey,
  collection: string,
  record: unknown,
  signal?: AbortSignal,
) {
  const row = deps.idem.reserve(key, collection, record);
  if (row.status === "complete") return row.result as any;
  try {
    const got = await deps.pds(s).getRecord(collection, row.rkey, signal);
    const out = meta(got);
    deps.idem.complete(key, out);
    return out;
  } catch (e: any) {
    if (!(e?.kind === "not_found")) throw mapError(e);
  }
  try {
    const made = await deps
      .pds(s)
      .createRecord(collection, row.rkey, record, signal);
    const out = meta(made);
    deps.idem.complete(key, out);
    return out;
  } catch (e) {
    try {
      const got = await deps.pds(s).getRecord(collection, row.rkey, signal);
      const out = meta(got);
      deps.idem.complete(key, out);
      return out;
    } catch {
      throw mapError(e);
    }
  }
}
/**
 * Idempotent update: reserve a requestId for the record's rkey and write with
 * compare-and-swap. A failed put cannot be recovered by reading: the read may
 * still return the pre-edit value, so retries reuse this rkey.
 */
export async function idempotentUpdate(
  deps: MutationDeps,
  s: AuthSession,
  key: MutationKey,
  collection: string,
  rkey: string,
  record: unknown,
  swapRecord?: string,
  signal?: AbortSignal,
) {
  const row = deps.idem.reserve(key, collection, record, rkey);
  if (row.status === "complete") return row.result as any;
  try {
    const updated = await deps
      .pds(s)
      .putRecord(collection, rkey, record, swapRecord, signal);
    const out = meta(updated);
    deps.idem.complete(key, out);
    return out;
  } catch (e) {
    throw mapError(e);
  }
}
