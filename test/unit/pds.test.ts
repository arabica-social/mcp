import { describe, it, expect } from "vitest";
import type { AuthSession } from "../../src/auth/client.js";
import { OAuthPdsRepository } from "../../src/pds/oauth-repository.js";
import { RepositoryError } from "../../src/pds/repository.js";
const DID = "did:plc:abc";
const BEAN = "social.arabica.alpha.bean";
function session(routes: Record<string, (init: RequestInit) => any>): {
  session: AuthSession;
  calls: Array<{ path: string; init: RequestInit }>;
} {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const handler = async (pathname: string, init: RequestInit) => {
    calls.push({ path: pathname, init });
    const route = Object.entries(routes).find(([prefix]) =>
      pathname.includes(prefix),
    );
    if (!route) return new Response("not found", { status: 404 });
    const out = typeof route[1] === "function" ? route[1](init) : route[1];
    if (out instanceof Response) return out;
    const body = out.body ?? {};
    return new Response(JSON.stringify(body), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    session: { did: DID, fetchHandler: handler as any },
    calls,
  };
}
describe("OAuthPdsRepository (atcute transport)", () => {
  it("lists records through the session fetch handler", async () => {
    const { session: s, calls } = session({
      "com.atproto.repo.listRecords": {
        body: {
          records: [
            {
              uri: `at://${DID}/${BEAN}/3jzfcijpj2z2a`,
              cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
              value: { $type: BEAN, name: "Ethiopia" },
            },
          ],
        },
      },
    });
    const repo = new OAuthPdsRepository(s);
    const out = await repo.listRecords(BEAN, 50);
    expect(out.records[0].rkey).toBe("3jzfcijpj2z2a");
    expect(out.records[0].value).toMatchObject({ name: "Ethiopia" });
    const url = calls[0].path;
    expect(url).toContain("/xrpc/com.atproto.repo.listRecords");
    expect(url).toContain(`repo=${encodeURIComponent(DID)}`);
    expect(url).toContain(`collection=${BEAN}`);
  });
  it("creates a record with the reserved rkey", async () => {
    const { session: s, calls } = session({
      "com.atproto.repo.createRecord": {
        body: {
          uri: `at://${DID}/${BEAN}/3jzfcijpj2z2a`,
          cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        },
      },
    });
    const repo = new OAuthPdsRepository(s);
    const out = await repo.createRecord(BEAN, "3jzfcijpj2z2a", {
      $type: BEAN,
      name: "x",
    });
    expect(out.uri).toBe(`at://${DID}/${BEAN}/3jzfcijpj2z2a`);
    const sent = JSON.parse(String((calls[0].init as RequestInit).body));
    expect(sent).toMatchObject({
      repo: DID,
      collection: BEAN,
      rkey: "3jzfcijpj2z2a",
      record: { $type: BEAN },
    });
  });
  it("maps missing records to not_found", async () => {
    const { session: s } = session({
      "com.atproto.repo.getRecord": {
        status: 400,
        body: { error: "RecordNotFound", message: "Could not locate record" },
      },
    });
    const repo = new OAuthPdsRepository(s);
    await expect(repo.getRecord(BEAN, "3jzfcijpj2z2a")).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(repo.getRecord(BEAN, "3jzfcijpj2z2a")).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });
  it("maps auth failures to permission", async () => {
    const { session: s } = session({
      "com.atproto.repo.listRecords": {
        status: 401,
        body: { error: "AuthRequired" },
      },
    });
    const repo = new OAuthPdsRepository(s);
    await expect(repo.listRecords(BEAN, 50)).rejects.toMatchObject({
      kind: "permission",
    });
  });
  it("maps 404 without RecordNotFound to unavailable, not not_found", async () => {
    // A missing endpoint is not a missing record.
    const { session: s } = session({
      "com.atproto.repo.getRecord": {
        status: 404,
        body: { error: "UnknownXRPCError", message: "no such endpoint" },
      },
    });
    const repo = new OAuthPdsRepository(s);
    await expect(repo.getRecord(BEAN, "3jzfcijpj2z2a")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
  it("maps InvalidSwap to conflict and forwards swapRecord", async () => {
    const { session: s, calls } = session({
      "com.atproto.repo.putRecord": {
        status: 409,
        body: { error: "InvalidSwap", message: "swap did not match" },
      },
    });
    const repo = new OAuthPdsRepository(s);
    const swapCid =
      "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    await expect(
      repo.putRecord(
        BEAN,
        "3jzfcijpj2z2a",
        { $type: BEAN, name: "x" },
        swapCid,
      ),
    ).rejects.toMatchObject({ kind: "conflict" });
    const sent = JSON.parse(String((calls[0].init as RequestInit).body));
    expect(sent).toMatchObject({ swapRecord: swapCid });
  });
  it("leaves cid undefined when the PDS omits it", async () => {
    const { session: s } = session({
      "com.atproto.repo.getRecord": {
        body: {
          uri: `at://${DID}/${BEAN}/3jzfcijpj2z2a`,
          value: { $type: BEAN, name: "Ethiopia" },
        },
      },
    });
    const repo = new OAuthPdsRepository(s);
    const out = await repo.getRecord(BEAN, "3jzfcijpj2z2a");
    expect(out.cid).toBeUndefined();
    expect(out.rkey).toBe("3jzfcijpj2z2a");
    expect(out.value).toMatchObject({ name: "Ethiopia" });
  });
  it("does not read a bogus rkey out of fragment or collection-level URIs", async () => {
    const { session: s } = session({
      "com.atproto.repo.listRecords": {
        body: {
          records: [
            {
              uri: `at://${DID}/${BEAN}/3jzfcijpj2z2a#/name`,
              cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
              value: { $type: BEAN, name: "Ethiopia" },
            },
          ],
        },
      },
    });
    const repo = new OAuthPdsRepository(s);
    await expect(repo.listRecords(BEAN, 50)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
  it("maps transport failures to unavailable", async () => {
    const handler = async () => {
      throw new TypeError("fetch failed");
    };
    const repo = new OAuthPdsRepository({
      did: DID,
      fetchHandler: handler as any,
    });
    await expect(repo.listRecords(BEAN, 50)).rejects.toMatchObject({
      kind: "unavailable",
      message: "PDS unavailable",
    });
  });
  it("rejects unsupported collections before any request", async () => {
    const { session: s, calls } = session({});
    const repo = new OAuthPdsRepository(s);
    await expect(
      repo.listRecords("com.example.other", 50),
    ).rejects.toMatchObject({ kind: "permission" });
    expect(calls.length).toBe(0);
  });
});
