import { describe, it, expect } from "vitest";
import { is } from "@atcute/lexicons";
import {
  SocialArabicaAlphaBean,
  SocialArabicaAlphaBrew,
  BEAN_COLLECTION,
  BREW_COLLECTION,
} from "../../src/generated/lexicons.js";
import { toBeanRecord } from "../../src/records/bean.js";
import { toBrewRecord } from "../../src/records/brew.js";
import { ownedBeanUri, ownedBrewUri } from "../../src/records/validation.js";
describe("record adapters", () => {
  it("writes required bean defaults", () => {
    const x = toBeanRecord({ requestId: "r", name: "Ethiopia" });
    expect(x).toMatchObject({
      $type: "social.arabica.alpha.bean",
      name: "Ethiopia",
      closed: false,
    });
    expect(x.createdAt).toMatch(/T/);
  });
  it("scales brew tenths and maps nested names", () => {
    const x = toBrewRecord({
      requestId: "r",
      beanUri: "at://did:plc:abc/social.arabica.alpha.bean/3jzfcijpj2z2a",
      temperature: 93.5,
      espresso: { yieldWeight: 36, pressure: 9 },
      pourover: { bloomWater: 40 },
    });
    expect(x).toMatchObject({
      temperature: 935,
      espressoParams: { yieldWeight: 360, pressure: 90 },
      pouroverParams: { bloomWater: 40 },
    });
  });
  it("rejects fractional wire values and invalid dates", () => {
    expect(() =>
      toBeanRecord({ requestId: "r", name: "x", roastDate: "2024-02-30" }),
    ).toThrow();
    expect(() =>
      toBrewRecord({
        requestId: "r",
        beanUri: "at://did:plc:abc/social.arabica.alpha.bean/3jzfcijpj2z2a",
        temperature: 93.55,
      }),
    ).toThrow();
  });
  it("produces records accepted by the generated atcute schemas", () => {
    const bean = toBeanRecord({
      requestId: "r",
      name: "Ethiopia",
      origin: "Yirgacheffe",
      rating: 8,
      link: "https://example.com/beans",
    });
    expect(is(SocialArabicaAlphaBean.mainSchema, bean)).toBe(true);
    const brew = toBrewRecord({
      requestId: "r",
      beanUri: "at://did:plc:abc/social.arabica.alpha.bean/3jzfcijpj2z2a",
      temperature: 93.5,
      pours: [{ waterAmount: 200, timeSeconds: 45 }],
      espresso: { yieldWeight: 36 },
      rating: 9,
    });
    expect(is(SocialArabicaAlphaBrew.mainSchema, brew)).toBe(true);
  });
  it("rejects wire records that violate the generated schemas", () => {
    const bean = toBeanRecord({ requestId: "r", name: "x" });
    expect(is(SocialArabicaAlphaBean.mainSchema, { ...bean, rating: 11 })).toBe(
      false,
    );
    expect(
      is(SocialArabicaAlphaBean.mainSchema, { ...bean, createdAt: "nope" }),
    ).toBe(false);
    const brew = toBrewRecord({
      requestId: "r",
      beanUri: "at://did:plc:abc/social.arabica.alpha.bean/3jzfcijpj2z2a",
    });
    expect(
      is(SocialArabicaAlphaBrew.mainSchema, { ...brew, temperature: 9000 }),
    ).toBe(false);
  });
  it("enforces UTF-8 byte length like the generated schemas", () => {
    // 51 four-byte emoji = 204 UTF-8 bytes, over the 200 maxLength, even
    // though the UTF-16 .length (51) would pass the old check.
    expect(() =>
      toBeanRecord({ requestId: "r", name: "😀".repeat(51) }),
    ).toThrow(/name exceeds 200 characters/);
    // exactly 200 UTF-8 bytes is still accepted.
    expect(toBeanRecord({ requestId: "r", name: "😀".repeat(50) }).name).toBe(
      "😀".repeat(50),
    );
  });
  it("accepts lexicon-format URIs for link", () => {
    const bean = toBeanRecord({ requestId: "r", name: "x", link: "1x:abc" });
    expect(is(SocialArabicaAlphaBean.mainSchema, bean)).toBe(true);
    expect(bean.link).toBe("1x:abc");
  });
});
describe("null clears optional record fields", () => {
  const beanUri = "at://did:plc:abc/social.arabica.alpha.bean/3jzfcijpj2z2a";
  it("clears optional bean fields when null is passed", () => {
    const base = toBeanRecord({
      requestId: "r",
      name: "Kenya",
      origin: "Nyeri",
      roastDate: "2024-01-15",
      link: "https://example.com/beans",
      roasterRef: "at://did:plc:abc/social.arabica.alpha.roaster/3jzfcijpj2z2a",
      rating: 8,
    });
    const cleared = toBeanRecord({
      ...base,
      requestId: "r",
      name: "Kenya",
      origin: null,
      roastDate: null,
      link: null,
      roasterRef: null,
      rating: null,
    });
    expect(cleared).toMatchObject({
      $type: BEAN_COLLECTION,
      name: "Kenya",
      closed: false,
    });
    for (const key of ["origin", "roastDate", "link", "roasterRef", "rating"])
      expect(cleared).not.toHaveProperty(key);
    expect(is(SocialArabicaAlphaBean.mainSchema, cleared)).toBe(true);
  });
  it("clears optional brew fields, including espresso and pourover params", () => {
    const base = toBrewRecord({
      requestId: "r",
      beanUri,
      method: "Espresso",
      temperature: 93.5,
      grindSize: "18",
      grinderRef: "at://did:plc:abc/social.arabica.alpha.grinder/3jzfcijpj2z2a",
      tastingNotes: "bright",
      rating: 9,
      pours: [{ waterAmount: 200, timeSeconds: 45 }],
      espresso: { yieldWeight: 36, pressure: 9 },
      pourover: { bloomWater: 40, filter: "paper" },
    });
    const cleared = toBrewRecord({
      ...base,
      requestId: "r",
      beanUri,
      method: null,
      temperature: null,
      grindSize: null,
      grinderRef: null,
      tastingNotes: null,
      rating: null,
      pours: null,
      espresso: null,
      pourover: null,
    });
    expect(cleared).toMatchObject({ $type: BREW_COLLECTION, beanRef: beanUri });
    for (const key of [
      "method",
      "temperature",
      "grindSize",
      "grinderRef",
      "tastingNotes",
      "rating",
      "pours",
      "espressoParams",
      "pouroverParams",
    ])
      expect(cleared).not.toHaveProperty(key);
    expect(is(SocialArabicaAlphaBrew.mainSchema, cleared)).toBe(true);
  });
});

describe("owned record URI helpers", () => {
  const did = "did:plc:abc";
  it("accepts an exact owned TID record URI", () => {
    const uri = `at://${did}/${BEAN_COLLECTION}/3jzfcijpj2z2a`;
    expect(ownedBeanUri(uri, did, BEAN_COLLECTION)).toEqual({
      uri,
      rkey: "3jzfcijpj2z2a",
    });
    const brewUri = `at://${did}/${BREW_COLLECTION}/3jzfcijpj2z2a`;
    expect(ownedBrewUri(brewUri, did, BREW_COLLECTION)).toEqual({
      uri: brewUri,
      rkey: "3jzfcijpj2z2a",
    });
  });
  it("rejects a foreign DID", () => {
    expect(() =>
      ownedBeanUri(
        "at://did:plc:other/social.arabica.alpha.bean/3jzfcijpj2z2a",
        did,
        BEAN_COLLECTION,
      ),
    ).toThrow(/not owned/);
  });
  it("rejects the wrong collection", () => {
    expect(() =>
      ownedBeanUri(
        `at://${did}/social.arabica.alpha.brew/3jxyz`,
        did,
        BEAN_COLLECTION,
      ),
    ).toThrow(/not a bean record/);
    expect(() =>
      ownedBrewUri(
        `at://${did}/social.arabica.alpha.bean/3jxyz`,
        did,
        BREW_COLLECTION,
      ),
    ).toThrow(/not a brew record/);
  });
  it("rejects handle authorities and non-canonical shapes", () => {
    expect(() =>
      ownedBeanUri(
        "at://alice.example/social.arabica.alpha.bean/3jzfcijpj2z2a",
        did,
        BEAN_COLLECTION,
      ),
    ).toThrow();
    expect(() =>
      ownedBeanUri(
        `at://${did}/social.arabica.alpha.bean/3jxyz?q=1`,
        did,
        BEAN_COLLECTION,
      ),
    ).toThrow();
  });
  it("accepts any valid record key, not just TIDs", () => {
    for (const rkey of ["self", "not-a-tid", "3jzfcijpj2z2a"]) {
      const uri = `at://${did}/${BEAN_COLLECTION}/${rkey}`;
      expect(ownedBeanUri(uri, did, BEAN_COLLECTION)).toEqual({
        uri,
        rkey,
      });
    }
  });
});
