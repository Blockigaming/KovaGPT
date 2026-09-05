import assert from "node:assert/strict";
import test from "node:test";
import { publishWorkProjectOutput } from "../../src/lib/work-output-publisher.mjs";
import { sha256Hex } from "../../src/lib/project-files-policy.mjs";
const OWNER = "11111111-1111-4111-8111-111111111111",
  RUN = "33333333-3333-4333-8333-333333333333";
const STEP = "44444444-4444-4444-8444-444444444444",
  PROJECT = "55555555-5555-4555-8555-555555555555";
const ARTIFACT = "66666666-6666-4666-8666-666666666666",
  FILE = "77777777-7777-4777-8777-777777777777";
async function fixture(options = {}) {
  const content = new TextEncoder().encode("Verified generated document");
  const output = {
    artifactId: ARTIFACT,
    sha256: await sha256Hex(content),
    mimeType: "text/plain",
    bytes: content.length,
  };
  const run = {
    id: RUN,
    ownerId: OWNER,
    epoch: 1,
    status: "running",
    stepIds: [STEP],
    request: { projectId: PROJECT },
  };
  const receipt = { runId: RUN, ownerId: OWNER, epoch: 1, stepId: STEP, inputHash: "a".repeat(64) };
  const calls = [];
  const dependencies = {
    assertLease: async () => {
      calls.push("lease");
      if (options.cancelled) throw new Error("cancelled");
    },
    readArtifact: async () => {
      calls.push("bytes");
      return { ...receipt, ...output, content: options.corrupt ? new Uint8Array([1]) : content };
    },
    publishProjectFile: async (metadata, bytes, verify, proof) => {
      calls.push("canonical_upload");
      assert.equal(metadata.projectId, PROJECT);
      assert.equal(metadata.idempotencyKey, ARTIFACT);
      assert.equal(verify, true);
      assert.equal(proof.run, run);
      assert.equal(proof.receipt, receipt);
      assert.equal(proof.output, output);
      assert.deepEqual(bytes, content);
      return { id: FILE, status: options.unconfirmed ? "pending" : "ready", project_id: PROJECT };
    },
    bindOutput: async (current, proof, descriptor, file) => {
      calls.push("durable_binding");
      assert.equal(file, FILE);
      assert.equal(proof.inputHash, receipt.inputHash);
      return { kind: "library", id: ARTIFACT };
    },
  };
  return { run, receipt, output, dependencies, calls };
}
test("fake adapter bytes pass through the real publisher contract only after hash verification and confirmed canonical upload", async () => {
  const f = await fixture();
  assert.deepEqual(await publishWorkProjectOutput(f.dependencies, f.run, f.receipt, f.output), {
    kind: "library",
    id: ARTIFACT,
  });
  assert.deepEqual(f.calls, [
    "lease",
    "bytes",
    "lease",
    "canonical_upload",
    "lease",
    "durable_binding",
  ]);
});
test("forged ownership, missing target, altered bytes, cancellation and unconfirmed Storage never publish Library references", async () => {
  for (const option of [{ corrupt: true }, { cancelled: true }, { unconfirmed: true }]) {
    const f = await fixture(option);
    await assert.rejects(publishWorkProjectOutput(f.dependencies, f.run, f.receipt, f.output));
    assert.equal(f.calls.includes("durable_binding"), false);
  }
  const f = await fixture();
  await assert.rejects(
    publishWorkProjectOutput(f.dependencies, f.run, { ...f.receipt, ownerId: PROJECT }, f.output),
    /binding/,
  );
  await assert.rejects(
    publishWorkProjectOutput(f.dependencies, { ...f.run, request: {} }, f.receipt, f.output),
    /binding/,
  );
  assert.equal(f.calls.length, 0);
});
