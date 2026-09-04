import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowsDirectory = new URL("../../.github/workflows/", import.meta.url);
const approvedActions = new Map([
  [
    "actions/checkout",
    {
      release: "v7.0.1",
      sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
      major: "v7",
      runtime: "node24",
    },
  ],
  [
    "actions/setup-node",
    {
      release: "v7.0.0",
      sha: "820762786026740c76f36085b0efc47a31fe5020",
      major: "v7",
      runtime: "node24",
    },
  ],
  [
    "actions/upload-artifact",
    {
      release: "v7.0.1",
      sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      major: "v7",
      runtime: "node24",
    },
  ],
  [
    "actions/download-artifact",
    {
      release: "v8.0.1",
      sha: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      major: "v8",
      runtime: "node24",
    },
  ],
  [
    "azure/login",
    {
      release: "v3.0.2",
      sha: "7ddb5af1ef8758cf1353cf3b42f940aee27ba21c",
      major: "v3",
      runtime: "node24",
    },
  ],
]);

const actionReference = /^\s*(?:-\s*)?uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#\s+(v\d+))?\s*$/u;

test("every workflow uses the reviewed immutable Node 24 action inventory", async () => {
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.ok(workflowFiles.length > 0, "Expected at least one GitHub Actions workflow");

  const seen = new Set();
  for (const workflowFile of workflowFiles) {
    const source = await readFile(new URL(workflowFile, workflowsDirectory), "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!line.includes("uses:")) continue;
      if (/uses:\s+\.\//u.test(line)) continue;

      const match = line.match(actionReference);
      assert.ok(
        match,
        `${workflowFile}:${index + 1} must pin an external action to a full commit SHA`,
      );
      const [, action, ref, documentedMajor] = match;
      const approved = approvedActions.get(action);
      assert.ok(approved, `${workflowFile}:${index + 1} uses unaudited external action ${action}`);
      assert.equal(
        ref,
        approved.sha,
        `${workflowFile}:${index + 1} must use reviewed ${action}@${approved.release}`,
      );
      assert.equal(
        documentedMajor,
        approved.major,
        `${workflowFile}:${index + 1} must document the reviewed major release`,
      );
      assert.equal(approved.runtime, "node24");
      seen.add(action);
    }
  }

  assert.deepEqual(
    [...seen].sort(),
    [...approvedActions.keys()].sort(),
    "The reviewed inventory must exactly describe every external workflow action",
  );
});
