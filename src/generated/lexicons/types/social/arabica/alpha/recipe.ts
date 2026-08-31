import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.recipe"),
    /**
     * AT-URI reference to a specific brewer record
     */
    brewerRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Fallback brewer type when no specific brewer is referenced (e.g., 'Pour-Over', 'French Press')
     * @maxLength 100
     */
    brewerType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 100),
      ]),
    ),
    /**
     * Amount of coffee in tenths of grams (e.g., 180 = 18.0g)
     * @minimum 0
     */
    coffeeAmount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * Timestamp when the recipe was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * User-given name for the recipe (e.g., 'James Hoffmann V60')
     * @maxLength 200
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 200),
    ]),
    /**
     * Free-text instructions, tips, or notes about the recipe
     * @maxLength 2000
     */
    notes: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 2000),
      ]),
    ),
    /**
     * Array of pour information for multi-pour methods
     */
    get pours() {
      return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(pourSchema));
    },
    /**
     * AT-URI of the recipe this was forked/copied from
     */
    sourceRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Amount of water in tenths of grams (e.g., 3000 = 300.0g)
     * @minimum 0
     */
    waterAmount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  }),
);
const _pourSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.arabica.alpha.recipe#pour"),
  ),
  /**
   * Time of this pour relative to brew start (seconds)
   * @minimum 0
   */
  timeSeconds: /*#__PURE__*/ v.integer(),
  /**
   * Amount of water in this pour (grams or ml)
   * @minimum 0
   */
  waterAmount: /*#__PURE__*/ v.integer(),
});

type main$schematype = typeof _mainSchema;
type pour$schematype = typeof _pourSchema;

export interface mainSchema extends main$schematype {}
export interface pourSchema extends pour$schematype {}

export const mainSchema = _mainSchema as mainSchema;
export const pourSchema = _pourSchema as pourSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}
export interface Pour extends v.InferInput<typeof pourSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.recipe": mainSchema;
  }
}
