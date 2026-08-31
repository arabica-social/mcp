import {
  BEAN_COLLECTION,
  BREW_COLLECTION,
  ROASTER_COLLECTION,
  GRINDER_COLLECTION,
  BREWER_COLLECTION,
  RECIPE_COLLECTION,
  COMMENT_COLLECTION,
  LIKE_COLLECTION,
} from "../generated/lexicons.js";
export type RecordMeta = {
  uri: string;
  /** CID of the record revision. Absent when the PDS did not return one. */
  cid?: string;
  rkey: string;
  value: unknown;
};
export interface PdsClient {
  readonly did: string;
  listRecords(
    collection: string,
    limit: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ records: RecordMeta[]; cursor?: string }>;
  getRecord(
    collection: string,
    rkey: string,
    signal?: AbortSignal,
  ): Promise<RecordMeta>;
  createRecord(
    collection: string,
    rkey: string,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<RecordMeta>;
  putRecord(
    collection: string,
    rkey: string,
    value: unknown,
    /** Compare-and-swap: only write when the current CID still matches. */
    swapRecord?: string,
    signal?: AbortSignal,
  ): Promise<RecordMeta>;
}
export class RepositoryError extends Error {
  constructor(
    readonly kind:
      "not_found" | "permission" | "unavailable" | "unknown" | "conflict",
    message: string,
  ) {
    super(message);
  }
}
/** Collections this client may read/write. Repos and DIDs are never caller-selectable. */
export function checkCollection(collection: string) {
  const allowed: ReadonlySet<string> = new Set([
    BEAN_COLLECTION,
    BREW_COLLECTION,
    ROASTER_COLLECTION,
    GRINDER_COLLECTION,
    BREWER_COLLECTION,
    RECIPE_COLLECTION,
    COMMENT_COLLECTION,
    LIKE_COLLECTION,
  ]);
  if (!allowed.has(collection))
    throw new RepositoryError("permission", "unsupported collection");
}
