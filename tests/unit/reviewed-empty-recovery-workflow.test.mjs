import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(
  readFileSync(
    new URL("../../.github/workflows/restore-reviewed-empty-recovery.yml", import.meta.url),
    "utf8",
  ),
);

const captureWorkflow = load(
  readFileSync(
    new URL("../../.github/workflows/capture-managed-auth-production.yml", import.meta.url),
    "utf8",
  ),
);
const capturePhraseBinding = captureWorkflow.jobs["capture-only"].steps.find(
  (step) => step.env?.KOVA_PRODUCTION_BACKUP_PASSPHRASE,
).env.KOVA_PRODUCTION_BACKUP_PASSPHRASE;
assert.equal(capturePhraseBinding, "${{ secrets.KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926 }}");

function validate(w) {
  assert.deepEqual(w.permissions, { contents: "read", actions: "read" });
  const job = w.jobs["restore-private-recipient"];
  assert.equal(job.environment.name, "production");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  for (const guard of [
    "github.event_name == 'workflow_dispatch'",
    "github.repository == 'Blockigaming/KovaGPT'",
    "github.ref == 'refs/heads/main'",
    "github.actor == github.repository_owner",
    "inputs.source_sha == github.sha",
    "inputs.confirmation == 'RESTORE_REVIEWED_PRIVATE_EMPTY_ONLY'",
  ]) {
    assert.ok(job.if.split(" && ").includes(guard));
  }
  assert.doesNotMatch(JSON.stringify(job.env), /secrets\.|DATABASE_URL|PASSPHRASE|GH_TOKEN/);
  const source = job.steps.find((step) => step.run?.includes("collect-empty-recovery-metadata.py"));
  const restore = job.steps.find((step) => step.run?.includes("--manifest-sha256"));
  assert.ok(job.steps.indexOf(source) < job.steps.indexOf(restore));
  assert.equal(
    source.env.KOVA_PRODUCTION_DATABASE_URL,
    "${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}",
  );
  assert.doesNotMatch(JSON.stringify(source), /BACKUP_PASSPHRASE|GH_TOKEN/);
  assert.equal(restore.env.KOVA_PRODUCTION_BACKUP_PASSPHRASE, capturePhraseBinding);
  assert.doesNotMatch(
    JSON.stringify(restore),
    /DATABASE_URL|PGPASSWORD|OPENAI_API_KEY|ELEVENLABS_API_KEY/,
  );
  assert.doesNotMatch(JSON.stringify(w.jobs["source-tests"]), /secrets\.|DATABASE_URL|GH_TOKEN/);
  const uploads = job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].with.path, /\/receipt\.json$/);
  assert.doesNotMatch(uploads[0].with.path, /\*|metadata|\.sql|\.gpg|catalog|phrase|state|\.oci/);
  assert.equal(uploads[0].with["retention-days"], 7);
  const cleanup = job.steps.find((step) => step.run?.includes("--cleanup-only"));
  assert.equal(cleanup.if, "always()");
  assert.match(cleanup.run, /cleanup_status=1/);
  assert.match(cleanup.run, /shutil\.rmtree\(source\)/);
  assert.match(cleanup.run, /exit "\$cleanup_status"/);
  const manifest = job.steps.find((step) => step.env?.REVIEW_MANIFEST_JSON);
  assert.match(manifest.run, /hashlib\.sha256\(raw\)\.hexdigest\(\) != expected/);
  assert.match(manifest.run, /os\.O_EXCL \| os\.O_NOFOLLOW, 0o600/);
}

test("reviewed recovery confines production URL to metadata and phrase to the guarded private restore", () => {
  validate(workflow);
});

test("credential, artifact and dispatch boundary mutations fail", () => {
  const mutations = [
    (w) => {
      w.jobs["restore-private-recipient"].steps.find((s) =>
        s.run?.includes("--manifest-sha256"),
      ).env.KOVA_PRODUCTION_BACKUP_PASSPHRASE = "${{ secrets.KOVA_PRODUCTION_BACKUP_PASSPHRASE }}";
    },
    (w) => {
      w.permissions.actions = "write";
    },
    (w) => {
      w.jobs["restore-private-recipient"].if = w.jobs["restore-private-recipient"].if.replace(
        " && github.actor == github.repository_owner",
        "",
      );
    },
    (w) => {
      w.jobs["restore-private-recipient"].if = w.jobs["restore-private-recipient"].if.replace(
        " && inputs.source_sha == github.sha",
        "",
      );
    },
    (w) => {
      w.jobs["restore-private-recipient"].env.KOVA_PRODUCTION_DATABASE_URL =
        "${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}";
    },
    (w) => {
      w.jobs["restore-private-recipient"].steps.find((s) =>
        s.run?.includes("--manifest-sha256"),
      ).env.KOVA_PRODUCTION_DATABASE_URL = "${{ secrets.KOVA_PRODUCTION_DATABASE_URL }}";
    },
    (w) => {
      w.jobs["restore-private-recipient"].steps.find((s) =>
        s.uses?.startsWith("actions/upload-artifact@"),
      ).with.path = "${{ runner.temp }}/**";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => validate(changed));
  }
});
