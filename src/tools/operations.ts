import { is, safeParse } from "@atcute/lexicons";
import {
  SocialArabicaAlphaBean,
  SocialArabicaAlphaBrew,
  SocialArabicaAlphaRoaster,
  BEAN_COLLECTION,
  BREW_COLLECTION,
  ROASTER_COLLECTION,
} from "../generated/lexicons.js";
import { toBeanRecord, AddBeanInput, BeanEditInput } from "../records/bean.js";
import { toBrewRecord, BrewInput, BrewEditInput } from "../records/brew.js";
import {
  ownedBeanUri,
  ownedBrewUri,
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
  let record;
  try {
    record = toBrewRecord(input);
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
  const conversionInput: Record<string, unknown> = {
    ...input,
    beanUri: String(currentRecord.beanRef),
  };
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
    ["tastingNotes", "tastingNotes"],
    ["rating", "rating"],
    ["pours", "pours"],
    ["espresso", "espressoParams"],
    ["pourover", "pouroverParams"],
  ];
  for (const [inputKey, recordKey] of fields) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey)) {
      const raw = (input as Record<string, unknown>)[inputKey];
      // null clears an optional field (delete semantics); toBrewRecord omits
      // nulls, so copy the value only for real updates.
      if (raw === null) delete next[recordKey];
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
