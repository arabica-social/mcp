import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.brewer"),
    /**
     * Category of brewer. Known values: pourover, espresso, immersion, mokapot, coldbrew, cupping, other
     * @maxLength 100
     */
    brewerType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(
        /*#__PURE__*/ v.string<
          | "coldbrew"
          | "cupping"
          | "espresso"
          | "immersion"
          | "mokapot"
          | "other"
          | "pourover"
          | (string & {})
        >(),
        [/*#__PURE__*/ v.stringLength(0, 100)],
      ),
    ),
    /**
     * Timestamp when the brewer record was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Description or notes about the brewer
     * @maxLength 1000
     */
    description: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 1000),
      ]),
    ),
    /**
     * Optional product, manual, or information URL for the brewer
     * @maxLength 500
     */
    link: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.genericUriString(), [
        /*#__PURE__*/ v.stringLength(0, 500),
      ]),
    ),
    /**
     * Name of the brewer (e.g., 'V60', 'Aeropress', 'Chemex')
     * @maxLength 200
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 200),
    ]),
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
    "social.arabica.alpha.brewer": mainSchema;
  }
}
