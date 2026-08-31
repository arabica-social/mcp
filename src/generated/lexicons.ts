/**
 * Bridge to the lex-cli generated Arabica lexicon schemas and the pinned
 * lexicon manifest. The schemas in `./lexicons/` are generated from the
 * digest-pinned lexicon documents; keep this file a pure re-export.
 */
export * from "./lexicons/index.js";
export {
  BEAN_COLLECTION,
  BREW_COLLECTION,
  ROASTER_COLLECTION,
  GRINDER_COLLECTION,
  BREWER_COLLECTION,
  RECIPE_COLLECTION,
  COMMENT_COLLECTION,
  LIKE_COLLECTION,
  lexiconManifest,
} from "./lexicon-manifest.js";
