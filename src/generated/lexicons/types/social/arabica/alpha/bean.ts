import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.bean"),
    /**
     * Whether the bag is closed/finished (default: false)
     */
    closed: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
    /**
     * Timestamp when the bean record was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Public roaster description or tasting notes for the beans
     * @maxLength 5000
     */
    description: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 5000),
      ]),
    ),
    /**
     * Optional product, vendor, or information URL for the beans
     * @maxLength 500
     */
    link: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.genericUriString(), [
        /*#__PURE__*/ v.stringLength(0, 500),
      ]),
    ),
    /**
     * Name of the coffee bean (e.g., 'Ethiopian Yirgacheffe', 'Morning Blend')
     * @maxLength 200
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 200),
    ]),
    /**
     * Personal notes about the beans
     * @maxLength 2000
     */
    notes: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 2000),
      ]),
    ),
    /**
     * Geographic origin of the beans (e.g., 'Ethiopia', 'Colombia')
     * @maxLength 200
     */
    origin: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 200),
      ]),
    ),
    /**
     * Processing method (e.g., 'Washed', 'Natural', 'Honey')
     * @maxLength 100
     */
    process: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 100),
      ]),
    ),
    /**
     * User rating of the bean (1-10 scale, optional)
     * @minimum 1
     * @maximum 10
     */
    rating: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 10),
      ]),
    ),
    /**
     * Optional date when the beans were roasted (YYYY-MM-DD)
     * @maxLength 10
     */
    roastDate: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 10),
      ]),
    ),
    /**
     * Roast level (e.g., 'Light', 'Medium', 'Dark')
     * @maxLength 100
     */
    roastLevel: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 100),
      ]),
    ),
    /**
     * AT-URI reference to the roaster record (e.g., at://did:plc:abc/social.arabica.alpha.roaster/3jxy...)
     */
    roasterRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * AT-URI of the record this entity was sourced from
     */
    sourceRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Coffee variety (e.g., 'SL28', 'Typica', 'Gesha', 'Caturra')
     * @maxLength 200
     */
    variety: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 200),
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
    "social.arabica.alpha.bean": mainSchema;
  }
}
