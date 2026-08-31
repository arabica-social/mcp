import type { PdsClient, RecordMeta } from "../pds/repository.js";
import { mapError } from "./errors.js";

/** Upper bounds for server-side scanning when a caller filter is set. */
export const SEARCH_MAX_PAGES = 5;
export const SEARCH_MAX_RECORDS = 500;

export type ListMatch<T> =
  | { kind: "match"; value: T }
  | { kind: "malformed"; errors: string[]; record: unknown }
  | { kind: "skip" };

export type CollectPagesOptions = {
  /** Caller's limit (already defaulted). Per-page size in single-page mode; match target in search mode. */
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
  /** When set, keep paging until enough matches, the cursor, or the bound. */
  searchMode: boolean;
};

export type CollectPagesResult<T> = {
  records: T[];
  malformed: Array<{ uri: string; errors: string[]; record: unknown }>;
  cursor?: string;
  /** True when the search hit SEARCH_MAX_PAGES/SEARCH_MAX_RECORDS and a cursor remains. */
  searchTruncated?: boolean;
};

/**
 * List a collection through the PDS. Without a filter this fetches exactly one
 * page (today's behavior) so paging stays caller-driven. With `searchMode`,
 * filter matches on later pages would otherwise be invisible, so page
 * internally (100 records per page, up to SEARCH_MAX_PAGES/SEARCH_MAX_RECORDS)
 * collecting matches until `limit` are found or the cursor is exhausted. When
 * the bound stops the scan with a cursor remaining, surface that in the result.
 */
export async function collectPages<T>(
  pds: PdsClient,
  collection: string,
  opts: CollectPagesOptions,
  match: (record: RecordMeta) => ListMatch<T>,
): Promise<CollectPagesResult<T>> {
  const pageSize = opts.searchMode ? 100 : opts.limit;
  let cursor = opts.cursor;
  let pages = 0;
  let scanned = 0;
  const records: T[] = [];
  const malformed: Array<{
    uri: string;
    errors: string[];
    record: unknown;
  }> = [];
  try {
    for (;;) {
      const page = await pds.listRecords(
        collection,
        pageSize,
        cursor,
        opts.signal,
      );
      pages += 1;
      scanned += page.records.length;
      for (const x of page.records) {
        const out = match(x);
        if (out.kind === "match") records.push(out.value);
        else if (out.kind === "malformed")
          malformed.push({
            uri: x.uri,
            errors: out.errors,
            record: out.record,
          });
      }
      cursor = page.cursor;
      if (!opts.searchMode) break;
      if (records.length >= opts.limit) break; // enough found
      if (cursor === undefined) break; // scanned everything
      if (pages >= SEARCH_MAX_PAGES || scanned >= SEARCH_MAX_RECORDS) break;
    }
  } catch (e) {
    throw mapError(e);
  }
  const truncated =
    opts.searchMode &&
    cursor !== undefined &&
    (pages >= SEARCH_MAX_PAGES || scanned >= SEARCH_MAX_RECORDS);
  return {
    records,
    malformed,
    cursor: truncated ? cursor : undefined,
    ...(truncated ? { searchTruncated: true } : {}),
  };
}
