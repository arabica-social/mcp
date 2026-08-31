import { safeParse } from "@atcute/lexicons";
import {
  SocialArabicaAlphaBrew,
  BREW_COLLECTION,
} from "../generated/lexicons.js";
import {
  assert,
  optionalString,
  integer,
  optionalNumber,
  timestamp,
  atUri,
  InputError,
} from "./validation.js";
export type BrewInput = {
  requestId: string;
  beanUri: string;
  createdAt?: string;
  method?: string | null;
  temperature?: number | null;
  waterAmount?: number | null;
  coffeeAmount?: number | null;
  timeSeconds?: number | null;
  grindSize?: string | null;
  grinderRef?: string | null;
  tastingNotes?: string | null;
  rating?: number | null;
  pours?: Array<{ waterAmount: number; timeSeconds: number }> | null;
  espresso?: {
    yieldWeight?: number;
    pressure?: number;
    preInfusionSeconds?: number;
  } | null;
  pourover?: {
    bloomWater?: number;
    bloomSeconds?: number;
    drawdownSeconds?: number;
    bypassWater?: number;
    filter?: string;
  } | null;
};
export type BrewEditInput = Omit<BrewInput, "beanUri"> & { brewUri: string };
export type BrewRecord = SocialArabicaAlphaBrew.Main;
const timesTen = (x: number, name: string) => {
  assert(
    Number.isInteger(x * 10),
    `${name} must have at most one decimal place`,
  );
  return x * 10;
};
export function toBrewRecord(input: BrewInput): BrewRecord {
  assert(
    typeof input.requestId === "string" &&
      input.requestId.length > 0 &&
      input.requestId.length <= 200,
    "requestId must be a non-empty string",
  );
  const r: Record<string, unknown> = {
    $type: BREW_COLLECTION,
    beanRef: atUri(input.beanUri, "beanUri"),
    createdAt: timestamp(input.createdAt, "createdAt"),
  };
  // Optionals are cleared by passing null (delete semantics), like
  // src/records/catalog.ts; beanRef and createdAt cannot be cleared.
  for (const [k, m] of Object.entries({
    method: 100,
    grindSize: 50,
    tastingNotes: 2000,
  })) {
    const x = input[k as keyof BrewInput];
    if (x === null) delete r[k];
    else {
      const out = optionalString(x, k, m);
      if (out !== undefined) r[k] = out;
    }
  }
  if (input.grinderRef === null) delete r.grinderRef;
  else if (input.grinderRef !== undefined)
    r.grinderRef = atUri(input.grinderRef, "grinderRef");
  for (const [k] of Object.entries({
    coffeeAmount: 0,
    waterAmount: 0,
    timeSeconds: 0,
  })) {
    const x = input[k as keyof BrewInput];
    if (x === null) delete r[k];
    else {
      const out = integer(x, k, 0);
      if (out !== undefined) r[k] = out;
    }
  }
  if (input.temperature === null) delete r.temperature;
  else {
    const t = optionalNumber(input.temperature, "temperature", 0, 212);
    if (t !== undefined) r.temperature = timesTen(t, "temperature");
  }
  if (input.rating === null) delete r.rating;
  else {
    const rating = integer(input.rating, "rating", 1, 10);
    if (rating !== undefined) r.rating = rating;
  }
  if (input.pours === null) delete r.pours;
  else if (input.pours !== undefined) {
    assert(Array.isArray(input.pours), "pours must be an array");
    assert(input.pours.length <= 100, "pours exceeds 100 items");
    r.pours = input.pours.map((p, i) => {
      assert(p && typeof p === "object", `pours[${i}] must be an object`);
      return {
        waterAmount: integer(p.waterAmount, `pours[${i}].waterAmount`, 0)!,
        timeSeconds: integer(p.timeSeconds, `pours[${i}].timeSeconds`, 0)!,
      };
    });
  }
  if (input.espresso === null) delete r.espressoParams;
  else if (input.espresso !== undefined) {
    const x = input.espresso;
    const e: Record<string, number> = {};
    for (const [k] of Object.entries({ yieldWeight: 0, pressure: 0 })) {
      const n = optionalNumber(x[k as keyof typeof x], `espresso.${k}`, 0);
      if (n !== undefined) e[k] = timesTen(n, `espresso.${k}`);
    }
    const pi = integer(x.preInfusionSeconds, "espresso.preInfusionSeconds", 0);
    if (pi !== undefined) e.preInfusionSeconds = pi;
    r.espressoParams = e;
  }
  if (input.pourover === null) delete r.pouroverParams;
  else if (input.pourover !== undefined) {
    const x = input.pourover;
    const p: Record<string, unknown> = {};
    for (const [k] of Object.entries({
      bloomWater: 0,
      bloomSeconds: 0,
      drawdownSeconds: 0,
      bypassWater: 0,
    })) {
      const n = integer(x[k as keyof typeof x], `pourover.${k}`, 0);
      if (n !== undefined) p[k] = n;
    }
    const f = optionalString(x.filter, "pourover.filter", 100);
    if (f !== undefined) p.filter = f;
    r.pouroverParams = p;
  }
  const result = safeParse(SocialArabicaAlphaBrew.mainSchema, r);
  if (!result.ok)
    throw new InputError(`invalid brew record: ${result.message}`);
  return result.value;
}
