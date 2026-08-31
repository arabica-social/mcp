import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _espressoParamsSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.arabica.alpha.brew#espressoParams"),
  ),
  /**
   * Pre-infusion time in seconds
   * @minimum 0
   */
  preInfusionSeconds: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Brewing pressure in tenths of a bar (e.g., 90 = 9.0 bar)
   * @minimum 0
   */
  pressure: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Espresso yield/output weight in tenths of a gram (e.g., 360 = 36.0g)
   * @minimum 0
   */
  yieldWeight: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
});
const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.brew"),
    /**
     * AT-URI reference to the bean record used
     */
    beanRef: /*#__PURE__*/ v.resourceUriString(),
    /**
     * AT-URI reference to the brewer/device used
     */
    brewerRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Amount of coffee used in grams
     * @minimum 0
     */
    coffeeAmount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * Timestamp when the brew was made
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Espresso-specific brewing parameters (optional)
     */
    get espressoParams() {
      return /*#__PURE__*/ v.optional(espressoParamsSchema);
    },
    /**
     * Grind size setting (can be numeric like '18' or descriptive like 'Medium')
     * @maxLength 50
     */
    grindSize: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 50),
      ]),
    ),
    /**
     * AT-URI reference to the grinder used
     */
    grinderRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Brewing method (e.g., 'Pour Over', 'French Press', 'Espresso')
     * @maxLength 100
     */
    method: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 100),
      ]),
    ),
    /**
     * Pour-over-specific brewing parameters (optional)
     */
    get pouroverParams() {
      return /*#__PURE__*/ v.optional(pouroverParamsSchema);
    },
    /**
     * Array of pour information for multi-pour methods (e.g., V60)
     */
    get pours() {
      return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(pourSchema));
    },
    /**
     * Rating of the brew from 1 to 10
     * @minimum 1
     * @maximum 10
     */
    rating: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 10),
      ]),
    ),
    /**
     * AT-URI reference to the recipe used for this brew
     */
    recipeRef: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.resourceUriString()),
    /**
     * Tasting notes and observations about the brew
     * @maxLength 2000
     */
    tastingNotes: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 2000),
      ]),
    ),
    /**
     * Water temperature in tenths of a degree Celsius or Fahrenheit (e.g., 935 = 93.5°C)
     * @minimum 0
     * @maximum 2120
     */
    temperature: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(0, 2120),
      ]),
    ),
    /**
     * Total brew time in seconds
     * @minimum 0
     */
    timeSeconds: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * Amount of water used in grams or milliliters
     * @minimum 0
     */
    waterAmount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  }),
);
const _pourSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.arabica.alpha.brew#pour"),
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
const _pouroverParamsSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.arabica.alpha.brew#pouroverParams"),
  ),
  /**
   * Bloom wait time in seconds
   * @minimum 0
   */
  bloomSeconds: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Water used for bloom in grams
   * @minimum 0
   */
  bloomWater: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Bypass water added after brewing in grams
   * @minimum 0
   */
  bypassWater: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Drawdown time in seconds (time after last pour until bed is dry)
   * @minimum 0
   */
  drawdownSeconds: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Type of filter used (e.g. paper, metal, cloth)
   * @maxLength 100
   */
  filter: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 100),
    ]),
  ),
});

type espressoParams$schematype = typeof _espressoParamsSchema;
type main$schematype = typeof _mainSchema;
type pour$schematype = typeof _pourSchema;
type pouroverParams$schematype = typeof _pouroverParamsSchema;

export interface espressoParamsSchema extends espressoParams$schematype {}
export interface mainSchema extends main$schematype {}
export interface pourSchema extends pour$schematype {}
export interface pouroverParamsSchema extends pouroverParams$schematype {}

export const espressoParamsSchema =
  _espressoParamsSchema as espressoParamsSchema;
export const mainSchema = _mainSchema as mainSchema;
export const pourSchema = _pourSchema as pourSchema;
export const pouroverParamsSchema =
  _pouroverParamsSchema as pouroverParamsSchema;

export interface EspressoParams extends v.InferInput<
  typeof espressoParamsSchema
> {}
export interface Main extends v.InferInput<typeof mainSchema> {}
export interface Pour extends v.InferInput<typeof pourSchema> {}
export interface PouroverParams extends v.InferInput<
  typeof pouroverParamsSchema
> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.brew": mainSchema;
  }
}
