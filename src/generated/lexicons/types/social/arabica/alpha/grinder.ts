import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.grinder"),
    /**
     * Type of burr (empty string for unknown)
     * @maxLength 20
     */
    burrType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.literalEnum(["", "blade", "conical", "flat"]),
    ),
    /**
     * Timestamp when the grinder record was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Type of grinder mechanism
     * @maxLength 20
     */
    grinderType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.literalEnum(["electric", "hand", "portable_electric"]),
    ),
    /**
     * Optional product, manual, or information URL for the grinder
     * @maxLength 500
     */
    link: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.genericUriString(), [
        /*#__PURE__*/ v.stringLength(0, 500),
      ]),
    ),
    /**
     * Name or model of the grinder (e.g., 'Baratza Encore', '1Zpresso JX')
     * @maxLength 200
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 200),
    ]),
    /**
     * Additional notes about the grinder
     * @maxLength 1000
     */
    notes: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 1000),
      ]),
    ),
    /**
     * AT-URI of the record this entity was sourced from
     */
    sourceRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.grinder": mainSchema;
  }
}
