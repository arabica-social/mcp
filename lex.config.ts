import { defineLexiconConfig } from "@atcute/lex-cli";

const arabicaNsids = [
  "social.arabica.alpha.bean",
  "social.arabica.alpha.brew",
  "social.arabica.alpha.roaster",
  "social.arabica.alpha.grinder",
  "social.arabica.alpha.brewer",
  "social.arabica.alpha.recipe",
  "social.arabica.alpha.comment",
  "social.arabica.alpha.like",
];

export default defineLexiconConfig({
  formatter: { type: "prettier" },
  pull: {
    outdir: "lexicons",
    clean: true,
    sources: [{ type: "atproto", mode: "nsids", nsids: arabicaNsids }],
  },
  generate: {
    files: ["lexicons/**/*.json"],
    outdir: "src/generated/lexicons",
    clean: true,
    imports: ["@atcute/atproto"],
  },
});
