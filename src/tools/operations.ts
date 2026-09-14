import { is, safeParse } from "@atcute/lexicons";
import {
  SocialArabicaAlphaBean,
  SocialArabicaAlphaBrew,
  SocialArabicaAlphaBrewer,
  SocialArabicaAlphaRecipe,
  SocialArabicaAlphaRoaster,
  BEAN_COLLECTION,
  BREWER_COLLECTION,
  BREW_COLLECTION,
  RECIPE_COLLECTION,
  ROASTER_COLLECTION,
} from "../generated/lexicons.js";
import { toBeanRecord, AddBeanInput, BeanEditInput } from "../records/bean.js";
import { toBrewRecord, BrewInput, BrewEditInput } from "../records/brew.js";
import {
  ownedBeanUri,
  ownedBrewUri,
  ownedRecordUri,
  ownedRoasterUri,
} from "../records/validation.js";
import type { PdsClient } from "../pds/repository.js";
import type { AuthProvider } from "../auth/client.js";
import { IdempotencyStore } from "../state/idempotency.js";
import { ToolFailure, mapError } from "./errors.js";
import { idempotentCreate, idempotentUpdate, meta } from "./mutations.js";
import { collectPages } from "./paging.js";
export type Deps = {
  auth: AuthProvider;
  pds: (session: Awaited<ReturnType<AuthProvider["getSession"]>>) => PdsClient;
  idem: IdempotencyStore;
  clientId: string;
};

async function session(deps: Deps) {
  try {
    return await deps.auth.getSession();
  } catch (e) {
    throw mapError(e);
  }
}

type BrewRecipeDefaults = Pick<
  BrewInput,
  "coffeeAmount" | "waterAmount" | "pours" | "brewerRef" | "pourover"
>;

/** Brewer type strings that count as pour-over, like the frontend's normalizeBrewerCategory. */
const POUROVER_BREWER_TYPES = new Set([
  "pourover",
  "pour-over",
  "pour over",
  "dripper",
]);

async function resolveRecipeDefaults(
  recipeValue: string,
  s: Awaited<ReturnType<AuthProvider["getSession"]>>,
  deps: Deps,
  signal?: AbortSignal,
): Promise<BrewRecipeDefaults> {
  let recipeRef;
  try {
    recipeRef = ownedRecordUri(
      recipeValue,
      s.did,
      RECIPE_COLLECTION,
      "recipeRef",
      "recipe",
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid recipe reference";
    throw new ToolFailure(
      message.includes("not owned") ? "record_not_owned" : "invalid_input",
      message,
    );
  }
  let recipe;
  try {
    recipe = await deps
      .pds(s)
      .getRecord(RECIPE_COLLECTION, recipeRef.rkey, signal);
  } catch (e: any) {
    if (e?.kind === "not_found")
      throw new ToolFailure(
        "record_not_found",
        "The selected recipe record was not found.",
      );
    throw mapError(e);
  }
  const checked = safeParse(SocialArabicaAlphaRecipe.mainSchema, recipe.value);
  if (!checked.ok)
    throw new ToolFailure(
      "invalid_record",
      "The selected recipe record is malformed.",
    );
  // Bloom derivation is best-effort: when the recipe has no brewerType, fall
  // back to the referenced brewer's type like the frontend; a missing or
  // malformed brewer record just skips the bloom.
  let brewerType = checked.value.brewerType;
  if (!brewerType && checked.value.brewerRef) {
    try {
      const brewerRef = ownedRecordUri(
        checked.value.brewerRef,
        s.did,
        BREWER_COLLECTION,
        "brewerRef",
        "brewer",
      );
      const brewer = await deps
        .pds(s)
        .getRecord(BREWER_COLLECTION, brewerRef.rkey, signal);
      const parsed = safeParse(
        SocialArabicaAlphaBrewer.mainSchema,
        brewer.value,
      );
      if (parsed.ok) brewerType = parsed.value.brewerType;
    } catch {}
  }
  // For pour-over recipes the first pour seeds the bloom: its water becomes
  // bloomWater and its time becomes bloomSeconds.
  const firstPour = checked.value.pours?.[0];
  const pourover =
    brewerType &&
    POUROVER_BREWER_TYPES.has(brewerType.toLowerCase().trim()) &&
    firstPour &&
    (firstPour.waterAmount > 0 || firstPour.timeSeconds > 0)
      ? {
          ...(firstPour.waterAmount > 0
            ? { bloomWater: firstPour.waterAmount }
            : {}),
          ...(firstPour.timeSeconds > 0
            ? { bloomSeconds: firstPour.timeSeconds }
            : {}),
        }
      : undefined;
  return {
    coffeeAmount:
      checked.value.coffeeAmount && checked.value.coffeeAmount > 0
        ? Math.round(checked.value.coffeeAmount / 10)
        : undefined,
    waterAmount:
      checked.value.waterAmount && checked.value.waterAmount > 0
        ? Math.round(checked.value.waterAmount / 10)
        : undefined,
    pours: checked.value.pours?.map((pour) => ({ ...pour })),
    brewerRef: checked.value.brewerRef,
    pourover,
  };
}

export async function listBeans(
  input: {
    query?: string;
    includeClosed?: boolean;
    limit?: number;
    cursor?: string;
  },
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  const q = input.query?.toLocaleLowerCase();
  const searchMode =
    input.query !== undefined || input.includeClosed !== undefined;
  const out = await collectPages(
    deps.pds(s),
    BEAN_COLLECTION,
    {
      limit: input.limit ?? 50,
      cursor: input.cursor,
      signal,
      searchMode,
    },
    (x) => {
      const checked = safeParse(SocialArabicaAlphaBean.mainSchema, x.value);
      if (!checked.ok)
        return {
          kind: "malformed",
          errors: [checked.message],
          record: x.value,
        };
      if (!input.includeClosed && checked.value.closed) return { kind: "skip" };
      const hay = [
        checked.value.name,
        checked.value.origin,
        checked.value.variety,
        checked.value.roastLevel,
        checked.value.process,
        checked.value.description,
        checked.value.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (q && !hay.includes(q)) return { kind: "skip" };
      return { kind: "match", value: meta({ ...x, value: x.value }) };
    },
  );
  return {
    beans: out.records,
    cursor: out.cursor,
    malformed: out.malformed,
    ...(out.searchTruncated ? { searchTruncated: true } : {}),
  };
}

export async function addBean(
  input: AddBeanInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  if (input.roasterRef) {
    let roaster;
    try {
      const ref = ownedRoasterUri(input.roasterRef, s.did, ROASTER_COLLECTION);
      roaster = await deps.pds(s).getRecord(ROASTER_COLLECTION, ref.rkey);
    } catch (e: any) {
      if (e?.kind === "not_found")
        throw new ToolFailure(
          "roaster_not_found",
          "The selected roaster record was not found.",
        );
      const msg = e instanceof Error ? e.message : "Invalid roaster reference";
      throw new ToolFailure(
        msg.includes("not owned") ? "roaster_not_owned" : "invalid_input",
        msg,
      );
    }
    if (!is(SocialArabicaAlphaRoaster.mainSchema, roaster.value))
      throw new ToolFailure(
        "invalid_record",
        "The selected roaster record is malformed.",
      );
  }
  let record;
  try {
    record = toBeanRecord(input);
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: "arabica_add_bean",
    requestId: input.requestId,
  };
  try {
    const out = await idempotentCreate(
      deps,
      s,
      key,
      BEAN_COLLECTION,
      record,
      signal,
    );
    return { bean: out };
  } catch (e) {
    throw mapError(e);
  }
}

export async function logBrew(
  input: BrewInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  let ref;
  try {
    ref = ownedBeanUri(input.beanUri, s.did, BEAN_COLLECTION);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid bean URI";
    throw new ToolFailure(
      msg.includes("not owned") ? "bean_not_owned" : "invalid_input",
      msg,
    );
  }
  let bean;
  try {
    bean = await deps.pds(s).getRecord(BEAN_COLLECTION, ref.rkey);
  } catch (e: any) {
    if (e?.kind === "not_found")
      throw new ToolFailure(
        "bean_not_found",
        "The selected bean record was not found.",
      );
    throw mapError(e);
  }
  if (!is(SocialArabicaAlphaBean.mainSchema, bean.value))
    throw new ToolFailure(
      "invalid_record",
      "The selected bean record is malformed.",
    );
  if (!(bean.value as Record<string, unknown>).roasterRef)
    throw new ToolFailure(
      "roaster_required",
      "The selected bean has no roaster. Ask the user which roaster applies, list roasters if needed, attach it with arabica_edit_bean, then retry this brew.",
    );
  let brewInput = input;
  if (input.recipeRef !== undefined && input.recipeRef !== null) {
    const defaults = await resolveRecipeDefaults(
      input.recipeRef,
      s,
      deps,
      signal,
    );
    brewInput = {
      ...input,
      coffeeAmount:
        input.coffeeAmount === undefined
          ? defaults.coffeeAmount
          : input.coffeeAmount,
      waterAmount:
        input.waterAmount === undefined
          ? defaults.waterAmount
          : input.waterAmount,
      pours: input.pours === undefined ? defaults.pours : input.pours,
      brewerRef:
        input.brewerRef === undefined ? defaults.brewerRef : input.brewerRef,
      pourover:
        input.pourover === undefined ? defaults.pourover : input.pourover,
    };
  }
  let record;
  try {
    record = toBrewRecord(brewInput);
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: "arabica_log_brew",
    requestId: input.requestId,
  };
  try {
    const out = await idempotentCreate(
      deps,
      s,
      key,
      BREW_COLLECTION,
      record,
      signal,
    );
    return { brew: out, bean: { uri: input.beanUri } };
  } catch (e) {
    throw mapError(e);
  }
}

export async function editBrew(
  input: BrewEditInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  let ref;
  try {
    ref = ownedBrewUri(input.brewUri, s.did, BREW_COLLECTION);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid brew URI";
    throw new ToolFailure("invalid_input", msg);
  }
  let current;
  try {
    current = await deps.pds(s).getRecord(BREW_COLLECTION, ref.rkey);
  } catch (e: any) {
    if (e?.kind === "not_found")
      throw new ToolFailure(
        "brew_not_found",
        "The selected brew record was not found.",
      );
    throw mapError(e);
  }
  // A malformed current record is allowed here: the merge below still runs
  // through toBrewRecord and a final safeParse, so an edit either repairs the
  // record or fails with a precise validation error.
  const changed = Object.keys(input).some(
    (key) => !["requestId", "brewUri"].includes(key),
  );
  if (!changed)
    throw new ToolFailure(
      "invalid_input",
      "At least one brew field must be supplied to edit.",
    );
  const currentRecord = current.value as Record<string, unknown>;
  const rebaseRecipe =
    input.recipeRef !== undefined && input.recipeRef !== null;
  let recipeDefaults: BrewRecipeDefaults | undefined;
  if (rebaseRecipe)
    recipeDefaults = await resolveRecipeDefaults(
      input.recipeRef as string,
      s,
      deps,
      signal,
    );
  const conversionInput: Record<string, unknown> = {
    ...input,
    beanUri: String(currentRecord.beanRef),
  };
  if (recipeDefaults) {
    for (const key of [
      "coffeeAmount",
      "waterAmount",
      "pours",
      "brewerRef",
      "pourover",
    ] as const) {
      if (
        !Object.prototype.hasOwnProperty.call(input, key) &&
        recipeDefaults[key] !== undefined
      )
        conversionInput[key] = recipeDefaults[key];
    }
  }
  const patchInput = conversionInput as unknown as BrewInput;
  let converted;
  try {
    converted = toBrewRecord(patchInput);
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const next: Record<string, unknown> = { ...currentRecord };
  const fields: Array<[keyof BrewInput, string]> = [
    ["createdAt", "createdAt"],
    ["method", "method"],
    ["temperature", "temperature"],
    ["waterAmount", "waterAmount"],
    ["coffeeAmount", "coffeeAmount"],
    ["timeSeconds", "timeSeconds"],
    ["grindSize", "grindSize"],
    ["grinderRef", "grinderRef"],
    ["brewerRef", "brewerRef"],
    ["recipeRef", "recipeRef"],
    ["tastingNotes", "tastingNotes"],
    ["rating", "rating"],
    ["pours", "pours"],
    ["espresso", "espressoParams"],
    ["pourover", "pouroverParams"],
  ];
  const recipeFields = new Set<keyof BrewInput>([
    "coffeeAmount",
    "waterAmount",
    "pours",
    "brewerRef",
  ]);
  // Only a recipe that actually derives a bloom owns pouroverParams; a
  // non-pour-over recipe leaves the brew's pourover params untouched.
  if (recipeDefaults?.pourover) recipeFields.add("pourover");
  for (const [inputKey, recordKey] of fields) {
    const supplied = Object.prototype.hasOwnProperty.call(input, inputKey);
    if (supplied || (rebaseRecipe && recipeFields.has(inputKey))) {
      const raw = supplied
        ? (input as Record<string, unknown>)[inputKey]
        : recipeDefaults?.[inputKey as keyof BrewRecipeDefaults];
      // null clears an optional field (delete semantics); toBrewRecord omits
      // nulls, so copy the value only for real updates.
      if (raw === null || raw === undefined) delete next[recordKey];
      else next[recordKey] = (converted as Record<string, unknown>)[recordKey];
    }
  }
  const finalRecord = safeParse(SocialArabicaAlphaBrew.mainSchema, next);
  if (!finalRecord.ok)
    throw new ToolFailure(
      "invalid_input",
      `invalid brew record: ${finalRecord.message}`,
    );
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: "arabica_edit_brew",
    requestId: input.requestId,
  };
  try {
    const out = await idempotentUpdate(
      deps,
      s,
      key,
      BREW_COLLECTION,
      ref.rkey,
      next,
      current.cid,
      signal,
    );
    return { brew: out };
  } catch (e) {
    throw mapError(e);
  }
}

export async function listBrews(
  input: { query?: string; limit?: number; cursor?: string },
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  const q = input.query?.toLocaleLowerCase();
  const searchMode = input.query !== undefined;
  const out = await collectPages(
    deps.pds(s),
    BREW_COLLECTION,
    {
      limit: input.limit ?? 50,
      cursor: input.cursor,
      signal,
      searchMode,
    },
    (x) => {
      const checked = safeParse(SocialArabicaAlphaBrew.mainSchema, x.value);
      if (!checked.ok)
        return {
          kind: "malformed",
          errors: [checked.message],
          record: x.value,
        };
      const value = x.value as Record<string, unknown>;
      const hay = [
        value.method,
        value.grindSize,
        value.tastingNotes,
        value.beanRef,
      ]
        .filter((v) => typeof v === "string")
        .join(" ")
        .toLocaleLowerCase();
      if (q && !hay.includes(q)) return { kind: "skip" };
      return { kind: "match", value: meta(x) };
    },
  );
  return {
    brews: out.records,
    cursor: out.cursor,
    malformed: out.malformed,
    ...(out.searchTruncated ? { searchTruncated: true } : {}),
  };
}

export async function editBean(
  input: BeanEditInput,
  deps: Deps,
  signal?: AbortSignal,
) {
  const s = await session(deps);
  let ref;
  try {
    ref = ownedBeanUri(input.beanUri, s.did, BEAN_COLLECTION);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid bean URI";
    throw new ToolFailure(
      message.includes("not owned") ? "bean_not_owned" : "invalid_input",
      message,
    );
  }
  let current;
  try {
    current = await deps.pds(s).getRecord(BEAN_COLLECTION, ref.rkey);
  } catch (e: any) {
    if (e?.kind === "not_found")
      throw new ToolFailure(
        "bean_not_found",
        "The selected bean record was not found.",
      );
    throw mapError(e);
  }
  // A malformed current record is allowed here: the merged result is
  // rebuilt through toBeanRecord, so an edit either repairs the record or
  // fails with a precise validation error.
  const changed = Object.keys(input).some(
    (key) => !["requestId", "beanUri"].includes(key),
  );
  if (!changed)
    throw new ToolFailure(
      "invalid_input",
      "At least one bean field must be supplied to edit.",
    );
  if (input.roasterRef) {
    try {
      const roasterRef = ownedRoasterUri(
        input.roasterRef,
        s.did,
        ROASTER_COLLECTION,
      );
      const roaster = await deps
        .pds(s)
        .getRecord(ROASTER_COLLECTION, roasterRef.rkey);
      if (!is(SocialArabicaAlphaRoaster.mainSchema, roaster.value))
        throw new ToolFailure(
          "invalid_record",
          "The selected roaster record is malformed.",
        );
    } catch (e: any) {
      if (e instanceof ToolFailure) throw e;
      if (e?.kind === "not_found")
        throw new ToolFailure(
          "roaster_not_found",
          "The selected roaster record was not found.",
        );
      const message =
        e instanceof Error ? e.message : "Invalid roaster reference";
      throw new ToolFailure(
        message.includes("not owned") ? "roaster_not_owned" : "invalid_input",
        message,
      );
    }
  }
  let next;
  try {
    next = toBeanRecord({
      ...(current.value as Record<string, unknown>),
      ...input,
      name: input.name ?? String((current.value as any).name),
      createdAt: input.createdAt ?? String((current.value as any).createdAt),
    } as AddBeanInput);
  } catch (e) {
    throw e instanceof Error ? new ToolFailure("invalid_input", e.message) : e;
  }
  const key = {
    clientId: deps.clientId,
    did: s.did,
    tool: "arabica_edit_bean",
    requestId: input.requestId,
  };
  try {
    return {
      bean: await idempotentUpdate(
        deps,
        s,
        key,
        BEAN_COLLECTION,
        ref.rkey,
        next,
        current.cid,
        signal,
      ),
    };
  } catch (e) {
    throw mapError(e);
  }
}
