import { readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import prettier from "prettier";
const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const names = [
  "bean",
  "brew",
  "roaster",
  "grinder",
  "brewer",
  "recipe",
  "comment",
  "like",
];
const sourceDir = resolve(root, "lexicons/social/arabica/alpha");
const lockPath = resolve(root, "lexicons.lock.json");
const manifestPath = resolve(root, "src/generated/lexicon-manifest.ts");
const outdir = resolve(root, "src/generated/lexicons");
const check = process.argv.includes("--check");
// Pin check: the Arabica lexicon documents must still match the locked digest.
const bytes = await Promise.all(
  names.map((n) => readFile(join(sourceDir, `${n}.json`))),
);
const sha = createHash("sha256").update(Buffer.concat(bytes)).digest("hex");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.sha256 !== sha)
  throw new Error(
    `lexicon digest mismatch: expected ${lock.sha256}, got ${sha}`,
  );
const manifestContent = await prettier.format(
  `/** Generated. Do not edit. */\n` +
    names
      .map(
        (name) =>
          `export const ${name.toUpperCase()}_COLLECTION = "social.arabica.alpha.${name}" as const;
`,
      )
      .join("") +
    `export const lexiconManifest = ${JSON.stringify(
      {
        version: lock.version,
        sha256: sha,
        collections: names.map((n) => `social.arabica.alpha.${n}`),
      },
      null,
      2,
    )} as const;\n`,
  { parser: "typescript" },
);
async function snapshot(dir: string) {
  const snap: Map<string, string> = new Map();
  const walk = async (d: string) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile())
        snap.set(relative(dir, full), await readFile(full, "utf8"));
    }
  };
  await walk(dir).catch((e: any) => {
    if (e.code !== "ENOENT") throw e;
  });
  return snap;
}
async function restore(dir: string, snap: Map<string, string>) {
  await rm(dir, { recursive: true, force: true });
  for (const [rel, content] of snap) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}
// Run the public lex-cli generator bin with the repo lex.config.ts.
const before = await snapshot(outdir);
const manifestBefore = await readFile(manifestPath, "utf8").catch(() => "");
await execFileAsync("pnpm", ["exec", "lex-cli", "generate"], { cwd: root });
await writeFile(manifestPath, manifestContent);
if (check) {
  const after = await snapshot(outdir);
  const stale =
    manifestBefore !== manifestContent ||
    after.size !== before.size ||
    [...before].some(([rel, content]) => after.get(rel) !== content);
  if (stale) {
    // Leave the tree as it was; the developer sees a clear stale error.
    await restore(outdir, before);
    await writeFile(manifestPath, manifestBefore);
    throw new Error("generated lexicon output is stale; run pnpm generate");
  }
}
