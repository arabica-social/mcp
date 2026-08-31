import {
  Client,
  ClientValidationError,
  ClientResponseError,
  ok,
} from "@atcute/client";
import {
  ComAtprotoRepoCreateRecord,
  ComAtprotoRepoGetRecord,
  ComAtprotoRepoListRecords,
  ComAtprotoRepoPutRecord,
} from "@atcute/atproto";
import type { ActorIdentifier, Nsid, RecordKey } from "@atcute/lexicons/syntax";
import { parseCanonicalResourceUri } from "@atcute/lexicons/syntax";
import type { AuthSession } from "../auth/client.js";
import {
  checkCollection,
  type PdsClient,
  type RecordMeta,
  RepositoryError,
} from "./repository.js";
const recordMeta = (x: {
  uri: string;
  cid?: string;
  rkey: string;
  value: unknown;
}): RecordMeta => ({ uri: x.uri, cid: x.cid, rkey: x.rkey, value: x.value });
// listRecords URIs are canonical at-uris (at://did/collection/rkey); the
// parser also rejects fragment URIs and collection-level URIs instead of
// returning a bogus rkey from the last path segment.
const rkeyOf = (uri: string) => parseCanonicalResourceUri(uri).rkey;
/**
 * User-scoped XRPC facade backed by an atcute Client. The client is driven by
 * the OAuth session's own fetch handler, so every request carries the
 * session's DPoP-bound authorization without a hand-rolled transport.
 */
export class OAuthPdsRepository implements PdsClient {
  private readonly rpc: Client;
  constructor(private readonly session: AuthSession) {
    this.rpc = new Client({ handler: session.fetchHandler });
  }
  get did() {
    return this.session.did;
  }
  /** Translates atcute failures into RepositoryError, the boundary type used by the operation layer. */
  private mapFailure(e: unknown): never {
    if (e instanceof RepositoryError) throw e;
    if (e instanceof ClientValidationError)
      throw new RepositoryError("unknown", "XRPC request failed validation");
    if (e instanceof ClientResponseError) {
      const { error, status } = e;
      if (error === "RecordNotFound")
        throw new RepositoryError("not_found", "record not found");
      if (error === "AuthRequired" || status === 401 || status === 403)
        throw new RepositoryError("permission", "request not permitted");
      if (error === "InvalidSwap" || status === 409)
        throw new RepositoryError("conflict", "record changed concurrently");
      // A 404 that is not a missing record means a missing endpoint, not a
      // missing record.
      if (status === 404)
        throw new RepositoryError("unavailable", "endpoint not found");
      throw new RepositoryError("unavailable", "PDS request failed");
    }
    throw new RepositoryError("unavailable", "PDS unavailable");
  }
  async listRecords(
    collection: string,
    limit: number,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    checkCollection(collection);
    // Values are validated at the boundary: the repo is the OAuth session DID,
    // the collection is one of the pinned Arabica collections, and cursors are
    // opaque PDS strings.
    const params = {
      repo: this.session.did as ActorIdentifier,
      collection: collection as Nsid,
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
    };
    try {
      const data = await ok(
        this.rpc.call(ComAtprotoRepoListRecords, { params, signal }),
      );
      return {
        records: data.records.map((x) =>
          recordMeta({
            uri: x.uri,
            cid: x.cid,
            rkey: rkeyOf(x.uri),
            value: x.value,
          }),
        ),
        cursor: data.cursor,
      };
    } catch (e) {
      this.mapFailure(e);
    }
  }
  async getRecord(collection: string, rkey: string, signal?: AbortSignal) {
    checkCollection(collection);
    const params = {
      repo: this.session.did as ActorIdentifier,
      collection: collection as Nsid,
      rkey: rkey as RecordKey,
    };
    try {
      const data = await ok(
        this.rpc.call(ComAtprotoRepoGetRecord, { params, signal }),
      );
      return recordMeta({
        uri: data.uri,
        cid: data.cid,
        rkey,
        value: data.value,
      });
    } catch (e) {
      this.mapFailure(e);
    }
  }
  async createRecord(
    collection: string,
    rkey: string,
    value: unknown,
    signal?: AbortSignal,
  ) {
    checkCollection(collection);
    const input = {
      repo: this.session.did as ActorIdentifier,
      collection: collection as Nsid,
      rkey: rkey as RecordKey,
      // The adapter-produced record is a validated lexicon record object.
      record: value as Record<string, unknown>,
    };
    try {
      const data = await ok(
        this.rpc.call(ComAtprotoRepoCreateRecord, { input, signal }),
      );
      return recordMeta({ uri: data.uri, cid: data.cid, rkey, value });
    } catch (e) {
      this.mapFailure(e);
    }
  }
  async putRecord(
    collection: string,
    rkey: string,
    value: unknown,
    swapRecord?: string,
    signal?: AbortSignal,
  ) {
    checkCollection(collection);
    const input = {
      repo: this.session.did as ActorIdentifier,
      collection: collection as Nsid,
      rkey: rkey as RecordKey,
      record: value as Record<string, unknown>,
      ...(swapRecord !== undefined ? { swapRecord } : {}),
    };
    try {
      const data = await ok(
        this.rpc.call(ComAtprotoRepoPutRecord, { input, signal }),
      );
      return recordMeta({ uri: data.uri, cid: data.cid, rkey, value });
    } catch (e) {
      this.mapFailure(e);
    }
  }
}
