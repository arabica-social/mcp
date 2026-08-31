import { safeParse } from "@atcute/lexicons";
import { isGenericUri } from "@atcute/lexicons/syntax";
import {
  SocialArabicaAlphaBean,
  BEAN_COLLECTION,
} from "../generated/lexicons.js";
import {
  assert,
  optionalString,
  integer,
  timestamp,
  roastDate,
  atUri,
  InputError,
} from "./validation.js";
export type AddBeanInput = {
  requestId: string;
  name: string;
  origin?: string | null;
  variety?: string | null;
  roastLevel?: string | null;
  roastDate?: string | null;
  process?: string | null;
  description?: string | null;
  notes?: string | null;
  link?: string | null;
  roasterRef?: string | null;
  sourceRef?: string | null;
  rating?: number | null;
  closed?: boolean | null;
  createdAt?: string;
};
export type BeanEditInput = {
  requestId: string;
  beanUri: string;
} & Partial<Omit<AddBeanInput, "requestId">>;
export type BeanRecord = SocialArabicaAlphaBean.Main;
export function toBeanRecord(input: AddBeanInput): BeanRecord {
  assert(
    typeof input.requestId === "string" &&
      input.requestId.length > 0 &&
      input.requestId.length <= 200,
    "requestId must be a non-empty string",
  );
  const name = optionalString(input.name, "name", 200);
  assert(
    name !== undefined && name.trim().length > 0,
    "name must not be empty",
  );
  const r: Record<string, unknown> = {
    $type: BEAN_COLLECTION,
    name,
    createdAt: timestamp(input.createdAt, "createdAt"),
    closed: input.closed ?? false,
  };
  // Optionals are cleared by passing null (delete semantics), like
  // src/records/catalog.ts; name and createdAt cannot be cleared.
  for (const [k, m] of Object.entries({
    origin: 200,
    variety: 200,
    roastLevel: 100,
    process: 100,
    description: 5000,
    notes: 2000,
  })) {
    const x = input[k as keyof AddBeanInput];
    if (x === null) delete r[k];
    else {
      const out = optionalString(x, k, m);
      if (out !== undefined) r[k] = out;
    }
  }
  if (input.roastDate === null) delete r.roastDate;
  else {
    const rd = roastDate(input.roastDate);
    if (rd !== undefined) r.roastDate = rd;
  }
  if (input.link === null) delete r.link;
  else if (input.link !== undefined) {
    const link = optionalString(input.link, "link", 500)!;
    if (!isGenericUri(link)) throw new InputError("link must be a valid URI");
    r.link = link;
  }
  if (input.roasterRef !== undefined) {
    if (input.roasterRef === null) delete r.roasterRef;
    else r.roasterRef = atUri(input.roasterRef, "roasterRef");
  }
  if (input.sourceRef === null) delete r.sourceRef;
  else if (input.sourceRef !== undefined)
    r.sourceRef = atUri(input.sourceRef, "sourceRef");
  if (input.rating === null) delete r.rating;
  else {
    const rating = integer(input.rating, "rating", 1, 10);
    if (rating !== undefined) r.rating = rating;
  }
  assert(typeof r.closed === "boolean", "closed must be a boolean");
  const result = safeParse(SocialArabicaAlphaBean.mainSchema, r);
  if (!result.ok)
    throw new InputError(`invalid bean record: ${result.message}`);
  return result.value;
}
