import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.roaster"),
    /**
     * Timestamp when the roaster record was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Location of the roaster (e.g., 'Raleigh, NC', 'Floyd, VA')
     * @maxLength 200
     */
    location: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 200),
      ]),
    ),
    /**
     * Name of the roaster (e.g., 'Black & White', 'Red Rooster')
     * @maxLength 200
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 200),
    ]),
    /**
     * AT-URI of the record this entity was sourced from
     */
    sourceRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Roaster's website URL
     * @maxLength 500
     */
    website: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.genericUriString(), [
        /*#__PURE__*/ v.stringLength(0, 500),
      ]),
    ),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.roaster": mainSchema;
  }
}
