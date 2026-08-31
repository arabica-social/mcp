import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as ComAtprotoRepoStrongRef from "@atcute/atproto/types/repo/strongRef";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.arabica.alpha.comment"),
    /**
     * Timestamp when the comment was created
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Optional parent comment reference for replies
     */
    get parent() {
      return /*#__PURE__*/ v.optional(ComAtprotoRepoStrongRef.mainSchema);
    },
    /**
     * The AT-URI and CID of the record being commented on
     */
    get subject() {
      return ComAtprotoRepoStrongRef.mainSchema;
    },
    /**
     * The comment text content
     * @maxLength 1000
     * @maxGraphemes 300
     */
    text: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 1000),
      /*#__PURE__*/ v.stringGraphemes(0, 300),
    ]),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.arabica.alpha.comment": mainSchema;
  }
}
