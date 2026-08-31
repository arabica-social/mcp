import { safeParse } from "@atcute/lexicons";
import { isGenericUri } from "@atcute/lexicons/syntax";
import {
  SocialArabicaAlphaBrewer,
  SocialArabicaAlphaComment,
  SocialArabicaAlphaGrinder,
  SocialArabicaAlphaLike,
  SocialArabicaAlphaRecipe,
  SocialArabicaAlphaRoaster,
  BREWER_COLLECTION,
  COMMENT_COLLECTION,
  GRINDER_COLLECTION,
  LIKE_COLLECTION,
  RECIPE_COLLECTION,
  ROASTER_COLLECTION,
} from "../generated/lexicons.js";
import {
  assert,
  atUri,
  integer,
  optionalNumber,
  optionalString,
  timestamp,
  InputError,
} from "./validation.js";

type AnyRecord = Record<string, unknown>;
export type CatalogKind =
  "roaster" | "grinder" | "brewer" | "recipe" | "comment" | "like";
export type CatalogInput = { requestId: string; [key: string]: unknown };
export type CatalogEditInput = CatalogInput & { recordUri: string };

type CatalogSchema =
  | SocialArabicaAlphaRoaster.mainSchema
  | SocialArabicaAlphaGrinder.mainSchema
  | SocialArabicaAlphaBrewer.mainSchema
  | SocialArabicaAlphaRecipe.mainSchema
  | SocialArabicaAlphaComment.mainSchema
  | SocialArabicaAlphaLike.mainSchema;

const definitions: Record<
  CatalogKind,
  { collection: string; schema: CatalogSchema; search: string[] }
> = {
  roaster: {
    collection: ROASTER_COLLECTION,
    schema: SocialArabicaAlphaRoaster.mainSchema,
    search: ["name", "location"],
  },
  grinder: {
    collection: GRINDER_COLLECTION,
    schema: SocialArabicaAlphaGrinder.mainSchema,
    search: ["name", "grinderType", "burrType", "notes"],
  },
  brewer: {
    collection: BREWER_COLLECTION,
    schema: SocialArabicaAlphaBrewer.mainSchema,
    search: ["name", "brewerType", "description"],
  },
  recipe: {
    collection: RECIPE_COLLECTION,
    schema: SocialArabicaAlphaRecipe.mainSchema,
    search: ["name", "brewerType", "notes"],
  },
  comment: {
    collection: COMMENT_COLLECTION,
    schema: SocialArabicaAlphaComment.mainSchema,
    search: ["text"],
  },
  like: {
    collection: LIKE_COLLECTION,
    schema: SocialArabicaAlphaLike.mainSchema,
    search: [],
  },
};

export function catalogDefinition(kind: CatalogKind) {
  return definitions[kind];
}

function checkRequestId(input: CatalogInput) {
  assert(
    typeof input.requestId === "string" &&
      input.requestId.length > 0 &&
      input.requestId.length <= 200,
    "requestId must be a non-empty string",
  );
}
/** Fields the lexicons mark required (no null delete possible). */
const requiredByLexicon: Partial<Record<CatalogKind, readonly string[]>> = {
  roaster: ["name"],
  grinder: ["name"],
  brewer: ["name"],
  recipe: ["name"],
  comment: ["subject", "text"],
  like: ["subject"],
};
function rejectClearingRequired(kind: CatalogKind, input: CatalogInput) {
  for (const field of requiredByLexicon[kind] ?? []) {
    if (field === "subject") {
      if (input.subjectUri === null || input.subjectCid === null)
        throw new InputError("subject cannot be cleared");
    } else if (input[field] === null) {
      throw new InputError(`${field} cannot be cleared`);
    }
  }
}
function text(input: AnyRecord, key: string, max: number, required = false) {
  const value = input[key];
  if (value === undefined) {
    if (required) throw new InputError(`${key} is required`);
    return undefined;
  }
  if (value === null) return null;
  const out = optionalString(value, key, max);
  if (required) assert(out!.trim().length > 0, `${key} must not be empty`);
  return out;
}
function uri(input: AnyRecord, key: string) {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return atUri(value, key);
}
function url(input: AnyRecord, key: string, max: number) {
  const value = text(input, key, max);
  if (value === undefined || value === null) return value;
  if (!isGenericUri(value)) throw new InputError(`${key} must be a valid URI`);
  return value;
}
function ref(input: AnyRecord, prefix: string, current?: AnyRecord) {
  const uriKey = `${prefix}Uri`;
  const cidKey = `${prefix}Cid`;
  const old = current?.[prefix] as AnyRecord | undefined;
  const uriValue = input[uriKey] === undefined ? old?.uri : input[uriKey];
  const cidValue = input[cidKey] === undefined ? old?.cid : input[cidKey];
  if (uriValue === undefined && cidValue === undefined) return undefined;
  if (uriValue === null || cidValue === null) return null;
  assert(
    uriValue !== undefined && cidValue !== undefined,
    `${uriKey} and ${cidKey} are required together`,
  );
  return {
    uri: atUri(uriValue, uriKey),
    cid: text({ [cidKey]: cidValue }, cidKey, 200, true),
  };
}
function pours(input: AnyRecord, current?: unknown) {
  if (input.pours === undefined) return current;
  if (input.pours === null) return null;
  assert(Array.isArray(input.pours), "pours must be an array");
  assert(input.pours.length <= 100, "pours exceeds 100 items");
  return input.pours.map((p, i) => {
    assert(!!p && typeof p === "object", `pours[${i}] must be an object`);
    const x = p as AnyRecord;
    return {
      waterAmount: integer(x.waterAmount, `pours[${i}].waterAmount`, 0),
      timeSeconds: integer(x.timeSeconds, `pours[${i}].timeSeconds`, 0),
    };
  });
}
function recipeAmount(input: AnyRecord, key: string, current?: unknown) {
  if (input[key] === undefined) return current;
  if (input[key] === null) return null;
  const n = optionalNumber(input[key], key, 0);
  assert(
    Number.isInteger(n! * 10),
    `${key} must have at most one decimal place`,
  );
  return n! * 10;
}

/** Convert the friendly MCP shape into one of the generated record shapes. */
export function toCatalogRecord(
  kind: CatalogKind,
  input: CatalogInput,
  existing?: AnyRecord,
): AnyRecord {
  checkRequestId(input);
  rejectClearingRequired(kind, input);
  const r: AnyRecord = existing
    ? { ...existing }
    : { $type: catalogDefinition(kind).collection };
  const name = text(
    input,
    "name",
    200,
    !existing && !["comment", "like"].includes(kind),
  );
  if (name !== undefined) r.name = name;
  const createdAt =
    input.createdAt === undefined
      ? (existing?.createdAt ?? timestamp(undefined, "createdAt"))
      : timestamp(input.createdAt, "createdAt");
  r.createdAt = createdAt;
  if (kind === "roaster") {
    for (const k of ["location"]) {
      const v = text(input, k, 200);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    const v = url(input, "website", 500);
    if (v === null) delete r.website;
    else if (v !== undefined) r.website = v;
    const sr = uri(input, "sourceRef");
    if (sr === null) delete r.sourceRef;
    else if (sr !== undefined) r.sourceRef = sr;
  } else if (kind === "grinder") {
    for (const k of ["grinderType", "burrType"]) {
      const v = text(input, k, 20);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    for (const [k, max] of [
      ["notes", 1000],
      ["link", 500],
    ] as const) {
      const v = k === "link" ? url(input, k, max) : text(input, k, max);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    const sr = uri(input, "sourceRef");
    if (sr === null) delete r.sourceRef;
    else if (sr !== undefined) r.sourceRef = sr;
  } else if (kind === "brewer") {
    for (const [k, max] of [
      ["brewerType", 100],
      ["description", 1000],
    ] as const) {
      const v = text(input, k, max);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    const link = url(input, "link", 500);
    if (link === null) delete r.link;
    else if (link !== undefined) r.link = link;
    const sr = uri(input, "sourceRef");
    if (sr === null) delete r.sourceRef;
    else if (sr !== undefined) r.sourceRef = sr;
  } else if (kind === "recipe") {
    const br = uri(input, "brewerRef");
    if (br === null) delete r.brewerRef;
    else if (br !== undefined) r.brewerRef = br;
    for (const k of ["brewerType"]) {
      const v = text(input, k, 100);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    for (const k of ["coffeeAmount", "waterAmount"]) {
      const v = recipeAmount(input, k, r[k]);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    const ps = pours(input, r.pours);
    if (ps === null) delete r.pours;
    else if (ps !== undefined) r.pours = ps;
    for (const k of ["notes"]) {
      const v = text(input, k, 2000);
      if (v === null) delete r[k];
      else if (v !== undefined) r[k] = v;
    }
    const sr = uri(input, "sourceRef");
    if (sr === null) delete r.sourceRef;
    else if (sr !== undefined) r.sourceRef = sr;
  } else if (kind === "comment") {
    const subject = ref(input, "subject", existing);
    if (subject !== null && subject !== undefined) r.subject = subject;
    else if (subject === null) delete r.subject;
    const t = text(input, "text", 1000, !existing);
    if (t === null) delete r.text;
    else if (t !== undefined) r.text = t;
    const parent = ref(input, "parent", existing);
    if (parent !== null && parent !== undefined) r.parent = parent;
    else if (parent === null) delete r.parent;
  } else if (kind === "like") {
    const subject = ref(input, "subject", existing);
    if (subject !== null && subject !== undefined) r.subject = subject;
    else if (subject === null) delete r.subject;
  }
  const checked = safeParse(catalogDefinition(kind).schema, r);
  if (!checked.ok)
    throw new InputError(`invalid ${kind} record: ${checked.message}`);
  return checked.value as AnyRecord;
}

export function catalogSearchFields(kind: CatalogKind) {
  return catalogDefinition(kind).search;
}
