import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const retired = [
  "src/lib/legacy-lovable-route.ts",
  "src/routes/[.]lovable.oauth.consent.tsx",
  "src/routes/lovable",
];

test("all Lovable compatibility routes and helpers are physically absent", () => {
  for (const path of retired) assert.equal(existsSync(path), false, path);
  const routeTree = readFileSync("src/routeTree.gen.ts", "utf8");
  assert.doesNotMatch(routeTree, /lovable/iu);
});

test("canonical OAuth consent is Kova-owned", () => {
  const consent = readFileSync("src/routes/oauth.consent.tsx", "utf8");
  assert.match(consent, /createFileRoute\("\/oauth\/consent"\)/u);
  assert.match(consent, /approveAuthorization/u);
  assert.match(consent, /denyAuthorization/u);
});

test("active packages and runtime source contain no Lovable dependency", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[group] ?? {})) assert.doesNotMatch(name, /lovable/iu);
  }
  assert.equal(existsSync(".lovable"), false);
  assert.equal(existsSync("bun.lock"), false);
});
