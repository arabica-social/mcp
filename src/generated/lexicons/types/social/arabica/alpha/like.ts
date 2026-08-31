import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as ComAtprotoRepoStrongRef from "@atcute/atproto/types/repo/strongRef";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.like"),
    /**
     * Timestamp when the like was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * The AT-URI and CID of the record being liked
     */
    get subject() {
      return ComAtprotoRepoStrongRef.mainSchema;
    },
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.like": mainSchema;
  }
}
