import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(
  readFileSync(
    new URL("../../.github/workflows/probe-empty-recovery-target.yml", import.meta.url),
    "utf8",
  ),
);

function validate(value) {
  const job = value.jobs["probe-empty"];
  assert.equal(job.environment.name, "production");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 25);
  assert.equal(value.permissions.contents, "read");
  assert.deepEqual(Object.keys(value.permissions), ["contents"]);
  for (const predicate of [
    "github.event_name == 'workflow_dispatch'",
    "github.repository == 'Blockigaming/KovaGPT'",
    "github.ref == 'refs/heads/main'",
    "inputs.source_sha == github.sha",
    "inputs.confirmation == 'PROBE_EMPTY_ONLY'",
    "inputs.approved_database_build == '17.6.1.155'",
  ]) {
    assert.ok(job.if.split(" && ").includes(predicate));
  }
  const secretSteps = job.steps.filter((step) =>
    Object.values(step.env ?? {}).some((v) => String(v).includes("secrets.")),
  );
  assert.equal(secretSteps.length, 1);
  assert.match(secretSteps[0].run, /collect-empty-recovery-metadata\.py/);
  assert.deepEqual(Object.keys(secretSteps[0].env), ["KOVA_PRODUCTION_DATABASE_URL"]);
  assert.doesNotMatch(JSON.stringify(job.env), /secrets\.|DATABASE_URL|PGPASSWORD/);
  const native = job.steps.find((step) => step.run?.includes("--metadata-file"));
  assert.ok(native);
  assert.doesNotMatch(
    JSON.stringify(native),
    /secrets\.|DATABASE_URL|PGPASSWORD|--archive|RESTORE_ISOLATED/,
  );
  const uploads = job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].with.path, /\/receipt\.json$/);
  assert.doesNotMatch(uploads[0].with.path, /\*|metadata|\.sql|dump|catalog|key|state/);
  assert.equal(uploads[0].with["retention-days"], 7);
  const cleanup = job.steps.find((step) => step.run?.includes("--cleanup-only"));
  assert.equal(cleanup.if, "always()");
  assert.match(cleanup.run, /cleanup_status=1/);
  assert.match(cleanup.run, /shutil\.rmtree\(target\)/);
  assert.match(cleanup.run, /exit "\$cleanup_status"/);
  assert.doesNotMatch(JSON.stringify(value.jobs["source-tests"]), /secrets\.|DATABASE_URL/);
}

test("data-free probe confines source credentials to the guarded metadata step and fixed receipt", () => {
  validate(workflow);
});

test("mutation checks reject credentials in client/job scope, broad uploads and unpinned dispatch", () => {
  const mutations = [
    (w) => {
      w.jobs["probe-empty"].env.KOVA_PRODUCTION_DATABASE_URL =
        "${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}";
    },
    (w) => {
      w.jobs["probe-empty"].steps.find((step) => step.run?.includes("--metadata-file")).env = {
        KOVA_PRODUCTION_DATABASE_URL: "${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}",
      };
    },
    (w) => {
      w.jobs["probe-empty"].steps.find((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
      ).with.path = "${{ runner.temp }}/**";
    },
    (w) => {
      w.jobs["probe-empty"].if = w.jobs["probe-empty"].if.replace(
        " && inputs.source_sha == github.sha",
        "",
      );
    },
    (w) => {
      w.jobs["probe-empty"].steps.find((step) => step.run?.includes("--cleanup-only")).if =
        "success()";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => validate(changed));
  }
});
