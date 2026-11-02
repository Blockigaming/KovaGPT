import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = new URL("../../", import.meta.url);
const source = readFileSync(
  new URL(".github/workflows/smoke-synthetic-recovery-native.yml", root),
  "utf8",
);

function validate(text) {
  const workflow = yaml.load(text);
  assert.deepEqual(Object.keys(workflow.on), ["pull_request"]);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(Object.keys(workflow.permissions).length, 1);
  const memory = workflow.jobs["native-capture-memory"];
  assert.equal(memory["runs-on"], "ubuntu-24.04");
  assert.equal(memory.environment, undefined);
  assert.equal(memory.env, undefined);
  assert.equal(memory["timeout-minutes"], 5);
  assert.match(memory.if, /github\.event_name == 'pull_request'/);
  assert.equal(memory.steps[0].with["persist-credentials"], false);
  const memoryPrepare = memory.steps.findIndex((step) =>
    step.run?.endsWith("private-capture-memory.py prepare"),
  );
  const memoryVerify = memory.steps.findIndex((step) =>
    step.run?.endsWith("private-capture-memory.py verify"),
  );
  const memoryCleanup = memory.steps.findIndex((step) =>
    step.run?.endsWith("private-capture-memory.py cleanup"),
  );
  assert.ok(memoryPrepare > 0 && memoryPrepare < memoryVerify && memoryVerify < memoryCleanup);
  const memoryCrypto = memory.steps.findIndex((step) =>
    step.run?.includes("module.crypt(os.environ"),
  );
  assert.ok(memoryVerify < memoryCrypto && memoryCrypto < memoryCleanup);
  assert.match(memory.steps[memoryCrypto].run, /KOVA_SYNTHETIC_ONLY_NOT_A_PRODUCTION_PASSPHRASE/);
  assert.match(memory.steps[memoryCrypto].run, /decrypt=True/);
  assert.equal(memory.steps[memoryCleanup].if, "always()");
  assert.equal(memory.steps[memoryCleanup]["continue-on-error"], undefined);
  assert.equal(
    memory.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@")).length,
    0,
  );
  const job = workflow.jobs["native-synthetic"];
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job.environment, undefined);
  assert.match(job.if, /github\.event_name == 'pull_request'/);
  assert.equal(job.env.KOVA_SYNTHETIC_NATIVE_CONFIRMATION, "SYNTHETIC_ONLY");
  assert.doesNotMatch(text, /secrets\.|pull_request_target|CAPTURE_ONLY|RESTORE_EMPTY_ISOLATED/);
  assert.equal(job.steps[0].with["persist-credentials"], false);
  const execute = job.steps.find((step) => step.run?.includes("--execute"));
  assert.match(execute.run, /--output.*\/receipt\.json/);
  const cleanup = job.steps.find((step) => step.run?.includes("--cleanup-only"));
  assert.equal(cleanup.if, "always()");
  const uploads = job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].if, "always()");
  assert.equal(uploads[0].with["retention-days"], 7);
  assert.match(uploads[0].with.path, /kova-synthetic-proof-.*\/receipt\.json$/);
  assert.doesNotMatch(uploads[0].with.path, /\*|\.tar|\.gpg|\.oci|inventory|metadata|sql/);
  const archive = workflow.jobs["native-oci-archive"];
  assert.equal(archive["runs-on"], "ubuntu-24.04");
  assert.equal(archive.environment, undefined);
  assert.match(archive.if, /github\.event_name == 'pull_request'/);
  assert.equal(archive.env.KOVA_SYNTHETIC_NATIVE_CONFIRMATION, "SYNTHETIC_ONLY");
  assert.equal(archive.steps[0].with["persist-credentials"], false);
  const archiveExecute = archive.steps.find((step) => step.run?.includes("--execute"));
  assert.match(archiveExecute.run, /smoke-generic-operator-archive-native\.py/);
  assert.match(archiveExecute.run, /--output.*\/receipt\.json/);
  const archiveCleanup = archive.steps.find((step) => step.run?.includes("--cleanup-only"));
  assert.equal(archiveCleanup.if, "always()");
  const archiveUploads = archive.steps.filter((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(archiveUploads.length, 1);
  assert.equal(archiveUploads[0].if, "always()");
  assert.equal(archiveUploads[0].with["retention-days"], 7);
  assert.match(archiveUploads[0].with.path, /kova-native-oci-archive-.*\/receipt\.json$/);
  assert.doesNotMatch(archiveUploads[0].with.path, /\*|\.tar|\.gpg|inventory|metadata|sql/);
  const generated = workflow.jobs["native-generated-schema-restore"];
  assert.equal(generated["runs-on"], "ubuntu-24.04");
  assert.equal(generated.environment, undefined);
  assert.equal(generated["timeout-minutes"], 35);
  assert.match(generated.if, /github\.event_name == 'pull_request'/);
  assert.match(generated.if, /github\.repository == 'Blockigaming\/KovaGPT'/);
  assert.deepEqual(Object.keys(generated.env).sort(), ["KOVA_SYNTHETIC_NATIVE_CONFIRMATION", "KOVA_SYNTHETIC_SOURCE_SHA"]);
  assert.equal(generated.env.KOVA_SYNTHETIC_NATIVE_CONFIRMATION, "SYNTHETIC_ONLY");
  assert.equal(generated.env.KOVA_SYNTHETIC_SOURCE_SHA, "${{ github.sha }}");
  assert.equal(generated.steps[0].with["persist-credentials"], false);
  const generatedExecute = generated.steps.find((step) => step.run?.includes("--execute"));
  assert.match(generatedExecute.run, /smoke-synthetic-schema-restore-native\.py --execute/);
  assert.match(generatedExecute.run, /--output.*\/receipt\.json/);
  assert.doesNotMatch(generatedExecute.run, /--archive|--phrase|--bindings/);
  const generatedCleanup = generated.steps.find((step) => step.run?.includes("--cleanup-only"));
  assert.equal(generatedCleanup.if, "always()");
  assert.match(generatedCleanup.run, /smoke-synthetic-schema-restore-native\.py --cleanup-only/);
  assert.ok(generated.steps.every((step) => step["continue-on-error"] === undefined));
  const generatedUploads = generated.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(generatedUploads.length, 1);
  assert.equal(generatedUploads[0].if, "always()");
  assert.equal(generatedUploads[0].with["retention-days"], 7);
  assert.match(generatedUploads[0].with.path, /kova-generated-schema-proof-.*\/receipt\.json$/);
  assert.doesNotMatch(generatedUploads[0].with.path, /\*|\.tar|\.gpg|\.oci|inventory|metadata|sql/);
}

test("generated schema restore cannot acquire credentials or bypass cleanup", () => {
  for (const mutate of [
    (job) => { job.environment = "production"; },
    (job) => { job.env.EXTRA = "private-input"; },
    (job) => { job.steps.find((step) => step.run?.includes("--cleanup-only")).if = "success()"; },
    (job) => { job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@")).with.path = "**/*"; },
  ]) {
    const changed = yaml.load(source);
    mutate(changed.jobs["native-generated-schema-restore"]);
    assert.throws(() => validate(yaml.dump(changed)));
  }
});

test("synthetic native PR smoke has no protected credentials, source or image artifact", () => {
  validate(source);
});

test("mutations cannot turn native synthetic smoke into a protected source or broad upload", () => {
  for (const changed of [
    source.replace("contents: read", "contents: write"),
    source.replace("pull_request:", "pull_request_target:"),
    source.replace(
      "    timeout-minutes: 35",
      "    environment: production\n    timeout-minutes: 35",
    ),
    source.replace(
      "      KOVA_SYNTHETIC_NATIVE_CONFIRMATION:",
      "      SOURCE_KEY: ${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}\n      KOVA_SYNTHETIC_NATIVE_CONFIRMATION:",
    ),
    source.replace("/receipt.json", "/*"),
    source.replace("if: always()", "if: success()"),
    source.replace(
      "    timeout-minutes: 30",
      "    environment: production\n    timeout-minutes: 30",
    ),
    source.replace(
      "kova-native-oci-archive-${{ github.run_id }}-${{ github.run_attempt }}/receipt.json",
      "kova-native-oci-archive-${{ github.run_id }}-${{ github.run_attempt }}/*",
    ),
  ]) {
    assert.throws(() => validate(changed));
  }
});

test("protected production source and capture workflow gates remain separately main only", () => {
  for (const path of [
    ".github/workflows/probe-empty-recovery-target.yml",
    ".github/workflows/capture-managed-auth-production.yml",
    ".github/workflows/prepare-recovery-operator-image.yml",
  ]) {
    const text = readFileSync(new URL(path, root), "utf8");
    assert.match(text, /github\.ref == 'refs\/heads\/main'/);
    assert.match(text, /workflow_dispatch:/);
  }
});
