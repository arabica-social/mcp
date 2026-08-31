import { describe, expect, it } from "vitest";
import { is } from "@atcute/lexicons";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toCatalogRecord } from "../../src/records/catalog.js";
import {
  SocialArabicaAlphaBrewer,
  SocialArabicaAlphaComment,
  SocialArabicaAlphaGrinder,
  SocialArabicaAlphaLike,
  SocialArabicaAlphaRecipe,
  SocialArabicaAlphaRoaster,
} from "../../src/generated/lexicons.js";
import { IdempotencyStore } from "../../src/state/idempotency.js";
import { BREW_COLLECTION } from "../../src/generated/lexicons.js";
import { editBrew, logBrew, type Deps } from "../../src/tools/operations.js";
import { ToolFailure } from "../../src/tools/errors.js";

const DID = "did:plc:test";
const URI = `at://${DID}/social.arabica.alpha.bean/3jzfcijpj2z2a`;
const CID = "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("remaining Arabica record adapters", () => {
  it.each([
    [
      "roaster",
      { requestId: "r", name: "Roaster" },
      SocialArabicaAlphaRoaster.mainSchema,
    ],
    [
      "grinder",
      {
        requestId: "r",
        name: "Grinder",
        grinderType: "hand",
        burrType: "conical",
      },
      SocialArabicaAlphaGrinder.mainSchema,
    ],
    [
      "brewer",
      { requestId: "r", name: "V60", brewerType: "pourover" },
      SocialArabicaAlphaBrewer.mainSchema,
    ],
    [
      "recipe",
      {
        requestId: "r",
        name: "Recipe",
        coffeeAmount: 18.5,
        waterAmount: 300,
        pours: [{ waterAmount: 300, timeSeconds: 180 }],
      },
      SocialArabicaAlphaRecipe.mainSchema,
    ],
    [
      "comment",
      { requestId: "r", subjectUri: URI, subjectCid: CID, text: "Nice cup" },
      SocialArabicaAlphaComment.mainSchema,
    ],
    [
      "like",
      { requestId: "r", subjectUri: URI, subjectCid: CID },
      SocialArabicaAlphaLike.mainSchema,
    ],
  ] as const)("creates a valid %s record", (kind, input, schema) => {
    const record = toCatalogRecord(kind, input);
    expect(is(schema, record)).toBe(true);
    if (kind === "recipe")
      expect(record).toMatchObject({ coffeeAmount: 185, waterAmount: 3000 });
  });

  it("preserves existing fields and clears an optional field on edit", () => {
    const old = toCatalogRecord("roaster", {
      requestId: "r",
      name: "Roaster",
      location: "VA",
      website: "https://roaster.example",
    });
    const next = toCatalogRecord(
      "roaster",
      { requestId: "r", location: null },
      old,
    );
    expect(next).toMatchObject({ name: "Roaster", createdAt: old.createdAt });
    expect(next).not.toHaveProperty("location");
    expect(next).toHaveProperty("website", "https://roaster.example");
  });
  it("rejects clearing required lexicon fields with a clear message", () => {
    const old = toCatalogRecord("roaster", {
      requestId: "r",
      name: "Roaster",
      location: "VA",
    });
    expect(() =>
      toCatalogRecord("roaster", { requestId: "r", name: null }, old),
    ).toThrowError("name cannot be cleared");
    const oldComment = toCatalogRecord("comment", {
      requestId: "r",
      subjectUri: URI,
      subjectCid: CID,
      text: "Nice cup",
    });
    expect(() =>
      toCatalogRecord("comment", { requestId: "r", text: null }, oldComment),
    ).toThrowError("text cannot be cleared");
    expect(() =>
      toCatalogRecord(
        "comment",
        { requestId: "r", subjectUri: null },
        oldComment,
      ),
    ).toThrowError("subject cannot be cleared");
    const oldLike = toCatalogRecord("like", {
      requestId: "r",
      subjectUri: URI,
      subjectCid: CID,
    });
    expect(() =>
      toCatalogRecord("like", { requestId: "r", subjectCid: null }, oldLike),
    ).toThrowError("subject cannot be cleared");
  });

  it("accepts lexicon-format URIs for website and link", () => {
    const roaster = toCatalogRecord("roaster", {
      requestId: "r",
      name: "Roaster",
      website: "1x:abc",
    });
    expect(roaster.website).toBe("1x:abc");
    expect(is(SocialArabicaAlphaRoaster.mainSchema, roaster)).toBe(true);
    const brewer = toCatalogRecord("brewer", {
      requestId: "r",
      name: "V60",
      link: "1x:abc",
    });
    expect(brewer.link).toBe("1x:abc");
    expect(is(SocialArabicaAlphaBrewer.mainSchema, brewer)).toBe(true);
  });
});

describe("brew roaster interaction", () => {
  it("asks the model to attach a roaster before logging a brew", async () => {
    const calls: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "arabica-test-"));
    const deps: Deps = {
      auth: {
        getSession: async () => ({
          did: DID,
          fetchHandler: async () => new Response(),
        }),
      },
      pds: () => ({
        did: DID,
        listRecords: async () => ({ records: [] }),
        getRecord: async (collection: string) => {
          calls.push(`get:${collection}`);
          return {
            uri: URI,
            cid: CID,
            rkey: "3jzfcijpj2z2a",
            value: {
              $type: "social.arabica.alpha.bean",
              name: "Bean",
              createdAt: new Date().toISOString(),
            },
          };
        },
        createRecord: async () => {
          calls.push("create");
          throw new Error("unexpected");
        },
        putRecord: async () => {
          calls.push("put");
          throw new Error("unexpected");
        },
      }),
      idem: new IdempotencyStore(join(dir, "idempotency.sqlite")),
      clientId: "test",
    };
    await expect(
      logBrew({ requestId: "r", beanUri: URI }, deps),
    ).rejects.toMatchObject({ code: "roaster_required" });
    expect(calls).toHaveLength(1);
  });
});

describe("editBrew clears optional params", () => {
  it("removes espresso and pourover params when null is passed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arabica-test-"));
    const BREW_URI = `at://${DID}/${BREW_COLLECTION}/3jzfcijpj2z2a`;
    const currentBrew = {
      $type: BREW_COLLECTION,
      beanRef: URI,
      method: "Espresso",
      espressoParams: { yieldWeight: 360, pressure: 90 },
      pouroverParams: { bloomWater: 40 },
      createdAt: new Date().toISOString(),
    };
    let written: unknown;
    const deps: Deps = {
      auth: {
        getSession: async () => ({
          did: DID,
          fetchHandler: async () => new Response(),
        }),
      },
      pds: () => ({
        did: DID,
        listRecords: async () => ({ records: [] }),
        getRecord: async (collection: string) => ({
          uri: BREW_URI,
          cid: CID,
          rkey: "3jzfcijpj2z2a",
          value: collection === BREW_COLLECTION ? currentBrew : {},
        }),
        createRecord: async () => {
          throw new Error("unexpected");
        },
        putRecord: async (_c: string, _r: string, record: unknown) => {
          written = record;
          return {
            uri: BREW_URI,
            cid: CID,
            rkey: "3jzfcijpj2z2a",
            value: record,
          };
        },
      }),
      idem: new IdempotencyStore(join(dir, "idempotency.sqlite")),
      clientId: "test",
    };
    await editBrew(
      { requestId: "r", brewUri: BREW_URI, espresso: null, pourover: null },
      deps,
    );
    expect(written).toMatchObject({ beanRef: URI, method: "Espresso" });
    expect(written).not.toHaveProperty("espressoParams");
    expect(written).not.toHaveProperty("pouroverParams");
  });
});
