import { safeParse } from "@atcute/lexicons";
import {
  SocialArabicaAlphaBrewer,
  SocialArabicaAlphaComment,
  SocialArabicaAlphaGrinder,
  SocialArabicaAlphaLike,
  SocialArabicaAlphaRecipe,
  SocialArabicaAlphaRoaster,
} from "../generated/lexicons.js";
import { ownedRecordUri } from "../records/validation.js";
import {
  catalogDefinition,
  catalogSearchFields,
  toCatalogRecord,
  type CatalogEditInput,
  type CatalogInput,
  type CatalogKind,
} from "../records/catalog.js";
import type { Deps } from "./operations.js";
import { ToolFailure, mapError } from "./errors.js";
import { idempotentCreate, idempotentUpdate, meta } from "./mutations.js";
import { collectPages } from "./paging.js";
const schemas: Record<CatalogKind, unknown> = {
  roaster: SocialArabicaAlphaRoaster.mainSchema,
  grinder: SocialArabicaAlphaGrinder.mainSchema,
  brewer: SocialArabicaAlphaBrewer.mainSchema,
  recipe: SocialArabicaAlphaRecipe.mainSchema,
  comment: SocialArabicaAlphaComment.mainSchema,
  like: SocialArabicaAlphaLike.mainSchema,
};
async function getSession(deps: Deps) {
  return deps.auth.getSession();
}

export async function listCatalog(
  kind: CatalogKind,
  input: { query?: string; limit?: number; cursor?: string },
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await getSession(deps);
  const definition = catalogDefinition(kind);
  const q = input.query?.toLocaleLowerCase();
  const searchMode = input.query !== undefined;
  const out = await collectPages(
    deps.pds(s),
    definition.collection,
    {
      limit: input.limit ?? 50,
      cursor: input.cursor,
      signal,
      searchMode,
    },
    (x) => {
      const checked = safeParse(schemas[kind] as any, x.value);
      if (!checked.ok)
        return {
          kind: "malformed",
          errors: [checked.message],
          record: x.value,
        };
      const record = x.value as Record<string, unknown>;
      const hay = catalogSearchFields(kind)
        .map((key) => record[key])
        .filter((v) => typeof v === "string")
        .join(" ")
        .toLocaleLowerCase();
      if (q && !hay.includes(q)) return { kind: "skip" };
      return { kind: "match", value: meta(x) };
    },
  );
  const plural = kind === "recipe" ? "recipes" : `${kind}s`;
  return {
    [plural]: out.records,
    cursor: out.cursor,
    malformed: out.malformed,
    ...(out.searchTruncated ? { searchTruncated: true } : {}),
  };
}

export async function createCatalog(
  kind: CatalogKind,
  input: CatalogInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await getSession(deps);
  let record;
  try {
    record = toCatalogRecord(kind, input);
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: `arabica_create_${kind}`,
    requestId: String(input.requestId),
  };
  try {
    return {
      [kind]: await idempotentCreate(
        deps,
        s,
        key,
        catalogDefinition(kind).collection,
        record,
        signal,
      ),
    };
  } catch (e) {
    throw mapError(e);
  }
}

export async function editCatalog(
  kind: CatalogKind,
  input: CatalogEditInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await getSession(deps);
  let ref;
  try {
    ref = ownedRecordUri(
      input.recordUri,
      s.did,
      catalogDefinition(kind).collection,
      "recordUri",
      kind,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid record URI";
    throw new ToolFailure(
      message.includes("not owned") ? "record_not_owned" : "invalid_input",
      message,
    );
  }
  let current;
  try {
    current = await deps
      .pds(s)
      .getRecord(catalogDefinition(kind).collection, ref.rkey);
  } catch (e: any) {
    if (e?.kind === "not_found")
      throw new ToolFailure(
        "record_not_found",
        `The selected ${kind} record was not found.`,
      );
    throw mapError(e);
  }
  // A malformed current record is allowed here: toCatalogRecord merges the
  // edit over it and the result must validate, so an edit either repairs the
  // record or fails with a precise validation error.
  const changed = Object.keys(input).some(
    (key) => !["requestId", "recordUri"].includes(key),
  );
  if (!changed)
    throw new ToolFailure(
      "invalid_input",
      `At least one ${kind} field must be supplied to edit.`,
    );
  let record;
  try {
    record = toCatalogRecord(
      kind,
      input,
      current.value as Record<string, unknown>,
    );
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: `arabica_edit_${kind}`,
    requestId: String(input.requestId),
  };
  try {
    return {
      [kind]: await idempotentUpdate(
        deps,
        s,
        key,
        catalogDefinition(kind).collection,
        ref.rkey,
        record,
        current.cid,
        signal,
      ),
    };
  } catch (e) {
    throw mapError(e);
  }
}
