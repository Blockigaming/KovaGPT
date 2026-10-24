import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { buildPluginPreview } from "./build-plugin-preview.mjs";
import { syntheticReviewPdf } from "./library-document-review-fixture.mjs";
const out = process.argv[2];
if (!out || !/^[a-f0-9]{40}$/.test(process.argv[3] ?? ""))
  throw Error("Usage: node review-kit/package.mjs /absolute/output/folder full-build-commit-sha");
const root = process.cwd();
const target = resolve(out);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
const baseline = "9cc0d1fd70832e6ac7d5f1ff003cf22b02de9f32";
// A restored full-source archive can lack historical Git objects. Keep the
// original recovery identity while making the included delta's base explicit.
const deltaBaseline = git("rev-parse", `${process.argv[4] ?? baseline}^{commit}`);
const buildCommit = git("rev-parse", `${process.argv[3]}^{commit}`);
if (
  git(
    "diff",
    buildCommit,
    "HEAD",
    "--",
    "src",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
  )
)
  throw Error("Application changed since the verified build");
mkdirSync(target, { recursive: false });
cpSync("docs/pdf-preview-font-licenses.txt", join(target, "THIRD-PARTY-PDF-FONTS.txt"));
mkdirSync(join(target, "review-samples"));
writeFileSync(join(target, "review-samples", "synthetic-two-page.pdf"), syntheticReviewPdf());
writeFileSync(
  join(target, "review-samples", "README.txt"),
  "Fictional local two-page PDF for composer page-selection and Library preview checks. No account data, upload, provider run or external fetch is included. Choose this file only inside the isolated review; do not send a message or upload it to a live service.\n",
);
mkdirSync(join(target, "review-samples", "pdf-pages"));
for (const name of [
  "README.md",
  "synthetic-all-blank.pdf",
  "synthetic-text-blank-failed.pdf",
  "synthetic-all-page-reads-failed.pdf",
  "synthetic-large-mediabox.pdf",
  "synthetic-101-page-limit.pdf",
  "synthetic-unsupported-cmap.pdf",
])
  cpSync(
    join(root, "review-kit", "review-samples", "pdf-pages", name),
    join(target, "review-samples", "pdf-pages", name),
  );
for (const name of ["dist"])
  cpSync(name, join(target, name), { recursive: true, dereference: true });
function materializeLinks(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (lstatSync(path).isSymbolicLink()) {
      const original = realpathSync(path);
      unlinkSync(path);
      cpSync(original, path, { recursive: true, dereference: true });
    }
    if (lstatSync(path).isDirectory()) materializeLinks(path);
  }
}
materializeLinks(join(target, "dist"));
for (const name of [
  "serve.mjs",
  "review.mjs",
  "README.md",
  "private-http-review.mjs",
  "PRIVATE-HTTP-REVIEW.md",
])
  cpSync(join("review-kit", name), join(target, name));
// Bundle review helper imports too: the portable runtime has no source-tree dependencies.
for (const name of [
  "download-diagnostic.mjs",
  "document-export-review-transport.mjs",
  "version-conflict-review-fixture.mjs",
  "chat-stream-review-fixture.mjs",
  "conditional-review-fixture.mjs",
  "project-move-review-fixture.mjs",
  "project-archive-review-fixture.mjs",
  "project-populated-archive-review-fixture.mjs",
  "project-member-review-fixture.mjs",
  "reviewed-memory-review-fixture.mjs",
  "generative-ui-review-fixture.mjs",
  "pinned-context-review-fixture.mjs",
  "library-document-review-fixture.mjs",
  "library-pdf-resource-review-fixture.mjs",
  "async-read-review-fixture.mjs",
  "support-review-fixture.mjs",
  "work-history-review-fixture.mjs",
  "directory-plugin-review-fixture.mjs",
  "management-review-fixture.mjs",
]) {
  await build({
    entryPoints: [join(root, "review-kit", name)],
    outfile: join(target, name),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
}
mkdirSync(join(target, "review"), { recursive: true });
cpSync("review-kit/network-guard.mjs", join(target, "review/network-guard.mjs"));
for (const [input, output] of [
  ["core-app-fixture.ts", "fixture.mjs"],
  ["actual-app-fixture.ts", "base-fixture.mjs"],
  ["recovery-crud-fixture.ts", "crud-fixture.mjs"],
]) {
  await build({
    entryPoints: [join(root, "tests/e2e", input)],
    outfile: join(target, "review", output),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
}
await build({
  entryPoints: [join(root, "review-kit/review-state-fixtures.mjs")],
  outfile: join(target, "review-state-fixtures.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
await build({
  entryPoints: [join(root, "review-kit/image-review-fixture.mjs")],
  outfile: join(target, "image-review-fixture.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
cpSync("src/assets/image-presets/origami.jpg", join(target, "review/image-review-sample.jpg"));
await buildPluginPreview(root, join(target, "review"));
const assets = ".nitro/vite/services/ssr/assets";
mkdirSync(join(target, assets), { recursive: true });
for (const file of readdirSync(assets).filter((x) => x.startsWith("vendor-tanstack")))
  cpSync(join(assets, file), join(target, assets, file));
for (const dependency of ["playwright-core", "tslib"])
  cpSync(join("node_modules", dependency), join(target, "node_modules", dependency), {
    recursive: true,
    dereference: true,
  });
writeFileSync(
  join(target, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      engines: { node: ">=24" },
      scripts: { start: "node review.mjs", "start:guest": "node serve.mjs" },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(target, "SOURCE.json"),
  JSON.stringify(
    {
      commit,
      tree,
      buildCommit,
      recoveryBaseline: baseline,
      deltaBaseline,
      status:
        "Separate specification400 candidate; inspect the exact evidence ledger for verification status; owner acceptance pending",
      runtime: "Node.js24; ordinary browser requires no Playwright dependency",
      services: "Synthetic isolated fixtures; no live service acceptance",
    },
    null,
    2,
  ) + "\n",
);
// Full source and cumulative patch are preserved separately, never bundled into the review runtime.
function files(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), prefix + e.name + "/") : [prefix + e.name],
  );
}
writeFileSync(
  join(target, "SHA256SUMS"),
  files(target)
    .sort()
    .map(
      (p) =>
        createHash("sha256")
          .update(readFileSync(join(target, p)))
          .digest("hex") +
        "  " +
        p,
    )
    .join("\n") + "\n",
);
console.log(
  JSON.stringify({ target, commit, tree, buildCommit, files: files(target).length }, null, 2),
);
