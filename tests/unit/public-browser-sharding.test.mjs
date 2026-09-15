import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PUBLIC_REVIEW_PATHS } from "../../src/lib/seo-policy.mjs";

const read = (path) => readFileSync(path, "utf8");
const publicFiles = ["public-surface-matrix.spec.ts", "public-detail-pages.spec.ts"];
const verificationProjects = ["phone-390x844", "tablet-1024x768", "desktop-1440x900"];

function evaluate(source, env = {}, modules = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    process: { env },
    require(name) {
      assert.ok(name in modules, `Unexpected test import: ${name}`);
      return modules[name];
    },
  });
  return exports;
}

function config(suite) {
  return evaluate(
    read("playwright.config.ts"),
    suite === undefined ? {} : { KOVA_BROWSER_SUITE: suite },
    { "@playwright/test": { defineConfig: (value) => value } },
  ).default;
}

function selectedFiles(configuration) {
  const matches = (pattern, file) => file === pattern.replace("**/", "");
  return readdirSync("tests/e2e")
    .filter((file) => file.endsWith(".spec.ts"))
    .filter((file) => !configuration.testIgnore.some((pattern) => matches(pattern, file)))
    .filter(
      (file) =>
        !configuration.testMatch ||
        configuration.testMatch.some((pattern) => matches(pattern, file)),
    )
    .sort();
}

test("core and public browser suites form an exact disjoint partition of the default suite", () => {
  const all = selectedFiles(config());
  const core = selectedFiles(config("core"));
  const publicSuite = selectedFiles(config("public"));
  assert.deepEqual(selectedFiles(config("all")), all);
  assert.deepEqual(publicSuite, [...publicFiles].sort());
  assert.equal(
    core.some((file) => publicSuite.includes(file)),
    false,
  );
  assert.deepEqual([...core, ...publicSuite].sort(), all);
  for (const suite of [undefined, "all", "core", "public"]) {
    const value = config(suite);
    assert.equal(value.fullyParallel, true);
    assert.equal(value.retries, 0);
    assert.equal(value.projects.length, 11);
  }
  assert.throws(() => config("typo"), /Unknown KOVA_BROWSER_SUITE/);
});

test("the actual public matrix retains every route and theme in bounded groups", () => {
  const registered = [];
  const register = (name) => registered.push(name);
  register.describe = { parallel: (_name, run) => run() };
  const source = read("tests/e2e/public-surface-matrix.spec.ts");
  for (const scope of [undefined, "expanded"]) {
    const { schedule } = evaluate(
      `${source}\nexport const schedule = { routesUnderTest, routeGroups, verificationProjects };`,
      scope ? { KOVA_PUBLIC_MATRIX_SCOPE: scope } : {},
      {
        "@playwright/test": { test: register },
        "../../src/lib/seo-policy.mjs": { PUBLIC_REVIEW_PATHS },
        "./hydration": {},
      },
    );
    const paths = Array.from(schedule.routesUnderTest);
    const groups = Array.from(schedule.routeGroups, (group) => Array.from(group));
    assert.ok(paths.length > 0);
    assert.deepEqual(groups.flat().sort(), [...paths].sort());
    assert.equal(new Set(groups.flat()).size, paths.length);
    assert.ok(groups.every((group) => group.length > 0 && group.length <= 12));
    assert.ok(groups.every((group) => Math.max(4 * 60_000, group.length * 2 * 20_000) <= 480_000));
    assert.deepEqual(Array.from(schedule.verificationProjects), verificationProjects);
    if (!scope) assert.deepEqual(paths, PUBLIC_REVIEW_PATHS);
  }
  assert.match(source, /for \(const colorScheme of \["light", "dark"\] as const\)/);
  assert.match(source, /for \(const route of routes\)/);
  assert.match(source, /test\.step\(`\$\{colorScheme\} \$\{route\}`/);
  assert.match(source, /waitUntil: "domcontentloaded", timeout: 15_000/);
  assert.match(source, /expect\(runtimeErrors,.*\)\.toEqual\(\[\]\)/);
});

test("public shards retain the three viewports and feed fail-closed existing required checks", () => {
  const workflow = read(".github/workflows/ci.yml");
  const section = (name, next) =>
    workflow.slice(workflow.indexOf(`\n  ${name}:`), workflow.indexOf(`\n  ${next}:`));
  const publicJob = section("public-surface", "browser");
  assert.match(publicJob, /needs: verify/);
  assert.match(publicJob, /KOVA_BROWSER_SUITE: "public"/);
  assert.match(publicJob, /PLAYWRIGHT_PREBUILT: "1"/);
  assert.match(publicJob, /project: \[phone-390x844, tablet-1024x768, desktop-1440x900\]/);
  assert.match(publicJob, /shard: \[1, 2, 3\]/);
  assert.match(
    publicJob,
    /--project=\$\{\{ matrix\.project \}\} --shard=\$\{\{ matrix\.shard \}\}\/3/,
  );
  assert.match(
    publicJob,
    /name: e2e-blob-public-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}/,
  );
  assert.match(publicJob, /if: always\(\)/);
  assert.match(publicJob, /if-no-files-found: error/);
  assert.doesNotMatch(publicJob, /continue-on-error|KOVA_PUBLIC_MATRIX_SCOPE/);
  assert.match(section("e2e-report", "isolated-database"), /pattern: e2e-blob-\*/);
  for (const [name, next] of [
    ["browser", "release-e2e"],
    ["release-e2e", "e2e-report"],
  ]) {
    const job = section(name, next);
    assert.match(job, /if: always\(\) && needs\.verify\.result == 'success'/);
    assert.match(job, /needs\.verify\.outputs\.run_ci == 'true'/);
    assert.match(job, /github\.event\.pull_request\.draft == false/);
    assert.match(job, /needs: \[verify, public-surface\]/);
    assert.match(job, /KOVA_BROWSER_SUITE: "core"/);
    assert.match(job, /PUBLIC_RESULT: \$\{\{ needs\.public-surface\.result \}\}/);
    assert.doesNotMatch(job, /continue-on-error/);
    const gate = job.match(/run: (test "\$PUBLIC_RESULT" = success)/)?.[1];
    assert.ok(gate);
    assert.ok(job.indexOf(gate) < job.indexOf("uses: actions/checkout@"));
    for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
      const run = spawnSync("bash", ["-euo", "pipefail", "-c", gate], {
        env: { ...process.env, PUBLIC_RESULT: result },
      });
      assert.equal(run.status === 0, result === "success", `${name}: ${result}`);
    }
  }
});
