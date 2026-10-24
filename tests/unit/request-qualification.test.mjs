import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceDigest,
  ACCEPTANCE_PROMPT,
} from "../../src/lib/generation-acceptance.server.mjs";
import {
  boundedCaptureBody,
  captureConstructedRequest,
  readRequestCapturePlan,
} from "../../src/lib/request-qualification.server.mjs";

const source = { commit: "1".repeat(40), tree: "2".repeat(40) };
const body = () => ({
  model: "gpt-5.6-luna",
  input: [{ role: "user", content: ACCEPTANCE_PROMPT }],
  instructions: "Private account context.",
  stream: true,
  store: false,
  service_tier: "default",
  max_output_tokens: 8000,
  reasoning: { effort: "low", summary: "auto" },
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "kova-capture-unit-"));
  const directory = join(root, "private");
  await mkdir(directory, { mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const time = Date.now();
  const plan = {
    version: 1,
    operationId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
    chatId: "33333333-3333-4333-8333-333333333333",
    source,
    authMode: "supabase",
    evidenceKind: "synthetic-fixture",
    notBefore: new Date(time - 1000).toISOString(),
    expiresAt: new Date(time + 60000).toISOString(),
  };
  const env = {
    KOVA_REQUEST_CAPTURE_ENABLED: "true",
    KOVA_REQUEST_CAPTURE_PLAN: JSON.stringify(plan),
    KOVA_REQUEST_CAPTURE_PLAN_SHA256: acceptanceDigest(plan),
    KOVA_REQUEST_CAPTURE_DIRECTORY: directory,
    AZURE_ENVIRONMENT: "staging",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    KOVA_AUTH_MODE: "supabase",
    KOVA_GENERATION_DISABLED: "true",
    AI_GENERATION_ENABLED: "false",
    KOVA_SPEECH_ENABLED: "false",
    KOVA_GENERATION_ACCEPTANCE_ENABLED: "false",
    KOVA_TEXT_PROVIDER: "openai",
    KOVA_SOURCE_TREE: source.tree,
  };
  const request = new Request("https://staging.test/api/chat", {
    headers: { "x-kova-request-capture": plan.operationId },
  });
  const capture = readRequestCapturePlan({
    request,
    getEnv: (name) => env[name],
    buildSha: source.commit,
  });
  return {
    root,
    directory,
    plan,
    env,
    request,
    capture,
    write: (overrides = {}) =>
      captureConstructedRequest({
        capture,
        body: body(),
        authMode: "supabase",
        signal: request.signal,
        ...overrides,
      }),
  };
}

test("disabled capture reads only its flag and never touches credential/configuration inputs", () => {
  const names = [];
  assert.equal(
    readRequestCapturePlan({
      request: new Request("https://staging.test/api/chat"),
      getEnv(name) {
        names.push(name);
        assert.equal(name, "KOVA_REQUEST_CAPTURE_ENABLED");
      },
      buildSha: "unknown",
    }),
    null,
  );
  assert.deepEqual(names, ["KOVA_REQUEST_CAPTURE_ENABLED"]);
});
test("private body shares exact clamp and preserves all real instructions and reasoning", () => {
  const prepared = body(),
    bounded = boundedCaptureBody(prepared);
  assert.equal(bounded.max_output_tokens, 64);
  assert.equal(prepared.max_output_tokens, 8000);
  assert.equal(bounded.instructions, prepared.instructions);
  assert.deepEqual(bounded.reasoning, prepared.reasoning);
  for (const changed of [
    { tools: [] },
    { max_output_tokens: 63 },
    { instructions: "a".repeat(32769) },
    { input: [{ role: "user", content: "different" }] },
  ])
    assert.throws(() => boundedCaptureBody({ ...prepared, ...changed }), /request_capture_denied/u);
});
test("directory and file symlinks cannot redirect a capture", async (t) => {
  const f = await fixture(t),
    alias = join(f.root, "alias"),
    target = join(f.root, "target.txt");
  await symlink(f.directory, alias);
  f.env.KOVA_REQUEST_CAPTURE_DIRECTORY = alias;
  await assert.rejects(f.write(), /request_capture_denied/u);
  f.env.KOVA_REQUEST_CAPTURE_DIRECTORY = f.directory;
  await writeFile(target, "untouched", { mode: 0o600 });
  await symlink(target, join(f.directory, `${f.plan.operationId}.json`));
  await assert.rejects(f.write(), /request_capture_denied/u);
  assert.equal(await readFile(target, "utf8"), "untouched");
});
test("a symlink swap after validation cannot redirect a held-directory write", async (t) => {
  const f = await fixture(t),
    moved = join(f.root, "moved"),
    attacker = join(f.root, "other");
  await mkdir(attacker, { mode: 0o700 });
  let checks = 0;
  const capture = {
    ...f.capture,
    validate() {
      f.capture.validate();
      if (++checks === 2) {
        renameSync(f.directory, moved);
        symlinkSync(attacker, f.directory);
      }
    },
  };
  const receipt = await f.write({ capture });
  assert.equal(receipt.status, "REQUEST_CAPTURED_NO_GENERATION");
  assert.deepEqual(await readdir(attacker), []);
  assert.equal(
    JSON.parse(await readFile(join(moved, `${f.plan.operationId}.json`), "utf8")).evidenceKind,
    "synthetic-fixture",
  );
});
test("capture rejects served-worktree paths and public directory modes", async (t) => {
  const f = await fixture(t);
  await rm(f.directory, { recursive: true });
  await mkdir(f.directory, { mode: 0o755 });
  await assert.rejects(f.write(), /request_capture_denied/u);
  const served = await mkdtemp(join(process.cwd(), ".capture-unit-"));
  t.after(() => rm(served, { recursive: true, force: true }));
  const capture = { ...f.capture, directory: served };
  await assert.rejects(f.write({ capture }), /request_capture_denied/u);
});
test("changed plan/disable state and abort fail before any artifact write", async (t) => {
  const f = await fixture(t);
  f.env.KOVA_GENERATION_DISABLED = "false";
  await assert.rejects(f.write(), /request_capture_denied/u);
  f.env.KOVA_GENERATION_DISABLED = "true";
  f.env.KOVA_REQUEST_CAPTURE_PLAN = JSON.stringify({
    ...f.plan,
    ownerId: "44444444-4444-4444-8444-444444444444",
  });
  await assert.rejects(f.write(), /request_capture_denied/u);
  f.env.KOVA_REQUEST_CAPTURE_PLAN = JSON.stringify(f.plan);
  await assert.rejects(f.write({ signal: AbortSignal.abort() }), /request_capture_denied/u);
  assert.deepEqual(await readdir(f.directory), []);
});
