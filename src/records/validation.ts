import {
  isDatetime,
  isRecordKey,
  parseCanonicalResourceUri,
  parseResourceUri,
  type ParsedCanonicalResourceUri,
} from "@atcute/lexicons/syntax";
import * as v from "@atcute/lexicons/validations";
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}
export class InputError extends Error {
  readonly code = "invalid_input" as const;
  constructor(message: string) {
    super(message);
  }
}
const stringMaxSchemas = new Map<number, v.BaseSchema>();
const stringMaxSchema = (max: number): v.BaseSchema => {
  let schema = stringMaxSchemas.get(max);
  if (schema === undefined) {
    schema = v.constrain(v.string(), [v.stringLength(0, max)]);
    stringMaxSchemas.set(max, schema);
  }
  return schema;
};
export const optionalString = (value: unknown, name: string, max: number) => {
  if (value === undefined) return undefined;
  assert(typeof value === "string", `${name} must be a string`);
  const result = v.safeParse(stringMaxSchema(max), value);
  if (!result.ok) throw new InputError(`${name} exceeds ${max} characters`);
  return value;
};
export const optionalNumber = (
  v: unknown,
  name: string,
  min: number,
  max?: number,
) => {
  if (v === undefined) return undefined;
  assert(
    typeof v === "number" && Number.isFinite(v),
    `${name} must be a finite number`,
  );
  assert(
    v >= min && (max === undefined || v <= max),
    `${name} is out of range`,
  );
  return v;
};
export const integer = (
  v: unknown,
  name: string,
  min: number,
  max?: number,
) => {
  const n = optionalNumber(v, name, min, max);
  if (n !== undefined)
    assert(Number.isInteger(n), `${name} must be an integer`);
  return n;
};
export function timestamp(v: unknown, name: string): string {
  const s = v === undefined ? new Date().toISOString() : v;
  assert(
    typeof s === "string" && isDatetime(s),
    `${name} must be an RFC 3339 datetime`,
  );
  return s;
}
export function roastDate(v: unknown): string | undefined {
  if (v === undefined) return;
  assert(
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
    "roastDate must be YYYY-MM-DD",
  );
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  assert(
    dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d,
    "roastDate is not a valid calendar date",
  );
  return v;
}
export function atUri(v: unknown, name: string): string {
  assert(typeof v === "string", `${name} must be an AT-URI`);
  try {
    parseResourceUri(v);
  } catch {
    throw new InputError(`${name} must be an AT-URI`);
  }
  return v;
}
export function ownedRecordUri(
  value: unknown,
  did: string,
  collection: string,
  field: string,
  kind: string,
): { uri: string; rkey: string } {
  assert(typeof value === "string", `${field} must be an AT-URI`);
  let parsed: ParsedCanonicalResourceUri;
  try {
    parsed = parseCanonicalResourceUri(value);
  } catch {
    throw new InputError(`${field} must be an AT-URI`);
  }
  assert(
    parsed.repo === did,
    `${field} is not owned by the authenticated user`,
  );
  assert(parsed.collection === collection, `${field} is not a ${kind} record`);
  assert(isRecordKey(parsed.rkey), `${field} must contain a valid record key`);
  return { uri: value, rkey: parsed.rkey };
}
export function ownedBeanUri(
  v: unknown,
  did: string,
  collection: string,
): { uri: string; rkey: string } {
  return ownedRecordUri(v, did, collection, "beanUri", "bean");
}
export function ownedBrewUri(
  v: unknown,
  did: string,
  collection: string,
): { uri: string; rkey: string } {
  return ownedRecordUri(v, did, collection, "brewUri", "brew");
}
export function ownedRoasterUri(
  v: unknown,
  did: string,
  collection: string,
): { uri: string; rkey: string } {
  return ownedRecordUri(v, did, collection, "roasterRef", "roaster");
}
