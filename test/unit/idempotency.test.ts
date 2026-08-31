import { describe, it, expect, vi } from "vitest";
import { IdempotencyStore } from "../../src/state/idempotency.js";
import { idempotentUpdate } from "../../src/tools/mutations.js";
import { RepositoryError } from "../../src/pds/repository.js";
import { ToolFailure } from "../../src/tools/errors.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const COLLECTION = "social.arabica.alpha.bean";
const RECORD = { $type: COLLECTION, name: "Ethiopia" };
const key = {
  clientId: "c",
  did: "did:plc:a",
  tool: "arabica_add_bean",
  requestId: "r",
};
const fresh = () =>
  new IdempotencyStore(join(tmpdir(), `arabica-${randomUUID()}.sqlite`));
describe("idempotency", () => {
  it("reserves a stable TID and stores completion", () => {
    const s = fresh();
    const a = s.reserve(key, COLLECTION, RECORD);
    expect(a.status).toBe("pending");
    expect(a.rkey).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    expect(a.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    s.complete(key, { uri: "at://x" });
    expect(s.reserve(key, COLLECTION, RECORD)).toMatchObject({
      status: "complete",
      rkey: a.rkey,
      result: { uri: "at://x" },
    });
  });
  it("hashes the payload stably and includes the collection", () => {
    const s = fresh();
    expect(s.reserve(key, COLLECTION, { a: 1, b: { c: 2 } }).status).toBe(
      "pending",
    );
    // Same data with different key order is the same input.
    expect(s.reserve(key, COLLECTION, { b: { c: 2 }, a: 1 })).toMatchObject({
      status: "pending",
    });
    // The same record against a different collection is a different input.
    expect(() =>
      s.reserve(key, "social.arabica.alpha.roaster", { a: 1, b: { c: 2 } }),
    ).toThrowError(ToolFailure);
  });
  it("rejects a reused requestId with different input", () => {
    const s = fresh();
    s.reserve(key, COLLECTION, RECORD);
    expect(() =>
      s.reserve(key, COLLECTION, { $type: COLLECTION, name: "x" }),
    ).toThrowError(
      expect.objectContaining({
        code: "conflict",
        message: "requestId reused with different input",
      }),
    );
    // Completion does not make a mismatched replay acceptable.
    s.complete(key, { uri: "at://x" });
    expect(() =>
      s.reserve(key, COLLECTION, { $type: COLLECTION, name: "y" }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }));
  });
  it("binds update identity to the rkey", () => {
    const s = fresh();
    s.reserve(key, COLLECTION, RECORD, "3jzfcijpj2z2a");
    // Same requestId, same payload, different rkey: an edit of another record,
    // not a replay of the first one.
    expect(() =>
      s.reserve(key, COLLECTION, RECORD, "3jzfcijpj2z2b"),
    ).toThrowError(expect.objectContaining({ code: "conflict" }));
    // The same rkey stays idempotent.
    expect(s.reserve(key, COLLECTION, RECORD, "3jzfcijpj2z2a")).toMatchObject({
      rkey: "3jzfcijpj2z2a",
      status: "pending",
    });
  });
  it("never writes a second record when a pending requestId is reused", async () => {
    const s = fresh();
    const putRecord = vi
      .fn()
      .mockRejectedValueOnce(
        new RepositoryError("unavailable", "PDS unavailable"),
      )
      .mockResolvedValue({
        uri: `at://did:plc:a/${COLLECTION}/3jzfcijpj2z2a`,
        rkey: "3jzfcijpj2z2a",
        value: RECORD,
      });
    const deps = {
      pds: () => ({ did: "did:plc:a", putRecord }),
      idem: s,
    };
    const updateKey = {
      ...key,
      tool: "arabica_edit_bean",
      requestId: "edit-again",
    };
    // First attempt fails on the wire; the row stays pending.
    await expect(
      idempotentUpdate(
        deps as any,
        { did: "did:plc:a" } as any,
        updateKey,
        COLLECTION,
        "3jzfcijpj2z2a",
        RECORD,
      ),
    ).rejects.toMatchObject({ code: "pds_unavailable" });
    // Reusing the requestId for a different rkey conflicts before any write:
    // neither the first rkey nor the second may be written.
    await expect(
      idempotentUpdate(
        deps as any,
        { did: "did:plc:a" } as any,
        updateKey,
        COLLECTION,
        "3jzfcijpj2z2b",
        RECORD,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(putRecord).toHaveBeenCalledTimes(1);
    expect(putRecord).toHaveBeenCalledWith(
      COLLECTION,
      "3jzfcijpj2z2a",
      RECORD,
      undefined,
      undefined,
    );
  });
  it("retries the same rkey after a pending failure", async () => {
    const s = fresh();
    const putRecord = vi
      .fn()
      .mockRejectedValueOnce(
        new RepositoryError("unavailable", "PDS unavailable"),
      )
      .mockResolvedValue({
        uri: `at://did:plc:a/${COLLECTION}/3jzfcijpj2z2a`,
        rkey: "3jzfcijpj2z2a",
        value: RECORD,
      });
    const deps = {
      pds: () => ({ did: "did:plc:a", putRecord }),
      idem: s,
    };
    const updateKey = {
      ...key,
      tool: "arabica_edit_bean",
      requestId: "edit-retry",
    };
    const session = { did: "did:plc:a" } as any;
    await expect(
      idempotentUpdate(
        deps as any,
        session,
        updateKey,
        COLLECTION,
        "3jzfcijpj2z2a",
        RECORD,
      ),
    ).rejects.toMatchObject({ code: "pds_unavailable" });
    const out = await idempotentUpdate(
      deps as any,
      session,
      updateKey,
      COLLECTION,
      "3jzfcijpj2z2a",
      RECORD,
    );
    expect(out).toMatchObject({
      uri: `at://did:plc:a/${COLLECTION}/3jzfcijpj2z2a`,
    });
    expect(putRecord).toHaveBeenCalledTimes(2);
  });
  it("accepts non-TID record keys for updates", async () => {
    const s = fresh();
    const putRecord = vi.fn(
      async (_c: string, rkey: string, value: unknown) => ({
        uri: `at://did:plc:a/${COLLECTION}/${rkey}`,
        rkey,
        value,
      }),
    );
    const deps = {
      pds: () => ({ did: "did:plc:a", putRecord }),
      idem: s,
    };
    const out = await idempotentUpdate(
      deps as any,
      { did: "did:plc:a" } as any,
      { ...key, tool: "arabica_edit_bean", requestId: "edit-self" },
      COLLECTION,
      "self",
      RECORD,
    );
    expect(out).toMatchObject({
      uri: `at://did:plc:a/${COLLECTION}/self`,
    });
    expect(putRecord).toHaveBeenCalledWith(
      COLLECTION,
      "self",
      RECORD,
      undefined,
      undefined,
    );
  });
  it("rejects invalid record keys with invalid_input", () => {
    const s = fresh();
    expect(() =>
      s.reserve({ ...key, requestId: "bad-rkey" }, COLLECTION, RECORD, "a b"),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
  it("prunes complete rows older than 30 days on construction", () => {
    const path = join(tmpdir(), `arabica-${randomUUID()}.sqlite`);
    const s = new IdempotencyStore(path);
    s.reserve(key, COLLECTION, RECORD);
    s.complete(key, { uri: "at://old" });
    const backdate = new Date(
      Date.now() - 40 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const db = new DatabaseSync(path);
    try {
      db.prepare("UPDATE mutations SET created_at=?").run(backdate);
    } finally {
      db.close();
    }
    const s2 = new IdempotencyStore(path);
    const row = s2.reserve(key, COLLECTION, RECORD);
    expect(row.status).toBe("pending");
    expect(row.rkey).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
  });
  it("keeps recent complete rows and old pending rows", () => {
    const path = join(tmpdir(), `arabica-${randomUUID()}.sqlite`);
    const s = new IdempotencyStore(path);
    s.reserve(key, COLLECTION, RECORD);
    s.complete(key, { uri: "at://recent" });
    const pendingKey = { ...key, requestId: "p" };
    const pending = s.reserve(pendingKey, COLLECTION, RECORD);
    const backdate = new Date(
      Date.now() - 40 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const db = new DatabaseSync(path);
    try {
      db.prepare(
        "UPDATE mutations SET created_at=? WHERE status='pending'",
      ).run(backdate);
    } finally {
      db.close();
    }
    const s2 = new IdempotencyStore(path);
    expect(s2.reserve(key, COLLECTION, RECORD)).toMatchObject({
      status: "complete",
      result: { uri: "at://recent" },
    });
    expect(s2.reserve(pendingKey, COLLECTION, RECORD)).toMatchObject({
      status: "pending",
      rkey: pending.rkey,
    });
  });
});
