import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACCEPTANCE_PROMPT,
  acceptanceDigest,
} from "../../src/lib/generation-acceptance.server.mjs";
import {
  countCapturedRequest,
  main,
  validateCapturedRequest,
} from "../../scripts/azure/count-captured-request.mjs";

const NOW = Date.UTC(2026, 9, 21, 12);
const SECRET = "synthetic-private-key-not-a-live-credential";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value, init = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
function fixture(kind = "synthetic-fixture") {
  const body = {
    model: "gpt-5.6-luna",
    input: [{ role: "user", content: ACCEPTANCE_PROMPT }],
    instructions: "private fixture account instructions never printed",
    reasoning: { effort: "low", summary: "auto" },
    stream: true,
    store: false,
    service_tier: "default",
    max_output_tokens: 64,
  };
  const capture = {
    version: 1,
    evidenceKind: kind,
    capturedAt: new Date(NOW).toISOString(),
    source: { commit: "1".repeat(40), tree: "2".repeat(40) },
    operationId: "11111111-1111-4111-8111-111111111111",
    capturePlanSha256: "3".repeat(64),
    body,
    bodySha256: acceptanceDigest(body),
    serializedBodySha256: hash(JSON.stringify(body)),
    serializedUtf8Bytes: Buffer.byteLength(JSON.stringify(body)),
  };
  const plan = {
    version: 1,
    expectedSource: capture.source,
    operationId: capture.operationId,
    capturePlanSha256: capture.capturePlanSha256,
    bodySha256: capture.bodySha256,
    expectedEvidenceKind: kind,
    notBefore: new Date(NOW - 1000).toISOString(),
    expiresAt: new Date(NOW + 60000).toISOString(),
    maximumInputTokens: 8192,
  };
  return { capture, plan };
}
async function privateDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "captured-count-test-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function execute(t, overrides = {}, dependencies = {}) {
  const outputDirectory = await privateDirectory(t);
  const f = { ...fixture(), outputDirectory, apiKey: SECRET, ...overrides };
  const calls = [];
  const result = await countCapturedRequest(f, {
    now: () => NOW,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return json({ object: "response.input_tokens", input_tokens: 123 });
    },
    ...dependencies,
  });
  return { ...f, result, calls };
}

test("default invocation reads neither files nor environment and makes no request", async () => {
  let reads = 0;
  const env = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error(SECRET);
      },
    },
  );
  for (const argv of [[], ["--capture", "/missing/private-file"]]) {
    assert.deepEqual(
      await main(argv, env, {
        fetcher() {
          throw Error("network forbidden");
        },
      }),
      {
        countEnabled: false,
        status: "COUNT_DISABLED",
        requestAttempts: 0,
        generationRequests: 0,
      },
    );
  }
  assert.equal(reads, 0);
});

test("valid count preserves exact supported fields, reserves before POST, and redacts evidence", async (t) => {
  const outputDirectory = await privateDirectory(t);
  const f = fixture();
  const calls = [];
  const result = await countCapturedRequest(
    { ...f, outputDirectory, apiKey: SECRET },
    {
      now: () => NOW,
      fetcher: async (url, init) => {
        calls.push({ url, init });
        const files = await readdir(outputDirectory);
        assert.deepEqual(files, [`token-count-${f.capture.operationId}.attempt.json`]);
        const reserved = JSON.parse(await readFile(join(outputDirectory, files[0]), "utf8"));
        assert.equal(reserved.status, "COUNT_ATTEMPT_RESERVED_NO_RETRY");
        return json({ object: "response.input_tokens", input_tokens: 123, private: SECRET });
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses/input_tokens");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: f.capture.body.model,
    input: f.capture.body.input,
    instructions: f.capture.body.instructions,
    reasoning: f.capture.body.reasoning,
  });
  assert.equal(result.inputTokens, 123);
  assert.equal(result.evidenceKind, "synthetic-fixture");
  assert.equal(result.captureAuthenticityVerified, false);
  assert.equal(result.executionAuthorityGranted, false);
  assert.equal(result.generationBodySha256, f.capture.bodySha256);
  assert.equal(result.countPayloadSha256, hash(calls[0].init.body));
  assert.match(result.responseSha256, /^[a-f0-9]{64}$/u);
  const { receiptSha256, ...receipt } = result;
  assert.equal(receiptSha256, acceptanceDigest(receipt));
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-private|private fixture account|Authorization/u,
  );
  for (const path of await readdir(outputDirectory))
    assert.doesNotMatch(
      await readFile(join(outputDirectory, path), "utf8"),
      /synthetic-private|private fixture account/u,
    );
});

test("actual-account evidence kind is preserved without claiming authenticity", async (t) => {
  const { result } = await execute(t, fixture("actual-account-request-capture"));
  assert.equal(result.evidenceKind, "actual-account-request-capture");
  assert.equal(result.captureAuthenticityVerified, false);
});

test("hash, source, kind, freshness, byte, prompt and plan tampering fail before any attempt", async (t) => {
  const patches = [
    (f) => {
      f.capture.body.instructions += " altered";
    },
    (f) => {
      f.plan.expectedSource = { ...f.plan.expectedSource, commit: "4".repeat(40) };
    },
    (f) => {
      f.plan.expectedEvidenceKind = "actual-account-request-capture";
    },
    (f) => {
      f.capture.capturedAt = new Date(NOW - 600001).toISOString();
    },
    (f) => {
      f.plan.expiresAt = new Date(NOW).toISOString();
    },
    (f) => {
      f.capture.serializedUtf8Bytes++;
    },
    (f) => {
      f.capture.serializedBodySha256 = "5".repeat(64);
    },
    (f) => {
      f.capture.body.input[0].content = "a different prompt";
    },
    (f) => {
      f.capture.body.tools = [];
    },
    (f) => {
      f.plan.maximumInputTokens = 8193;
    },
  ];
  const outputDirectory = await privateDirectory(t);
  let requests = 0;
  for (const patch of patches) {
    const f = fixture();
    patch(f);
    await assert.rejects(
      countCapturedRequest(
        { ...f, outputDirectory, apiKey: SECRET },
        {
          now: () => NOW,
          fetcher: async () => {
            requests++;
          },
        },
      ),
      /^Error: captured_count_/u,
    );
  }
  assert.equal(requests, 0);
  assert.deepEqual(await readdir(outputDirectory), []);
});

test("replay remains blocked after successful count", async (t) => {
  const f = await execute(t);
  await assert.rejects(
    countCapturedRequest(f, {
      now: () => NOW,
      fetcher() {
        throw Error("must not retry");
      },
    }),
    /captured_count_attempt_already_reserved/u,
  );
});

test("concurrent executors admit only one fixed POST for the reserved operation", async (t) => {
  const outputDirectory = await privateDirectory(t);
  const input = { ...fixture(), outputDirectory, apiKey: SECRET };
  let calls = 0;
  const dependencies = {
    now: () => NOW,
    fetcher: async () => {
      calls++;
      return json({ object: "response.input_tokens", input_tokens: 123 });
    },
  };
  const results = await Promise.allSettled([
    countCapturedRequest(input, dependencies),
    countCapturedRequest(input, dependencies),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.match(rejected.reason.message, /captured_count_attempt_already_reserved/u);
});

test("plan expiry during local reservation consumes the attempt without a POST", async (t) => {
  const outputDirectory = await privateDirectory(t);
  const input = { ...fixture(), outputDirectory, apiKey: SECRET };
  let ticks = 0;
  let calls = 0;
  const result = await countCapturedRequest(input, {
    now: () => (ticks++ === 0 ? NOW : NOW + 60001),
    fetcher() {
      calls++;
      throw Error("expired request must not be sent");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.attemptConsumed, true);
  assert.equal(result.requestAttempts, 0);
  assert.equal(result.failureCode, "captured_count_request_aborted");
});

test("HTTP error, ambiguous network result, and raw provider secrets never cause replay or leak", async (t) => {
  for (const fetcher of [
    async () => new Response(`upstream-private-${SECRET}`, { status: 429 }),
    async () => {
      throw Error(`ambiguous-private-${SECRET}`);
    },
  ]) {
    let calls = 0;
    const f = await execute(
      t,
      {},
      {
        fetcher: (...args) => {
          calls++;
          return fetcher(...args);
        },
      },
    );
    assert.equal(f.result.status, "COUNT_FAILED_ATTEMPT_CONSUMED");
    assert.equal(f.result.attemptConsumed, true);
    assert.equal(calls, 1);
    assert.doesNotMatch(
      JSON.stringify(f.result),
      /upstream-private|ambiguous-private|synthetic-private/u,
    );
    await assert.rejects(countCapturedRequest(f, { now: () => NOW, fetcher }), /already_reserved/u);
  }
});

test("transport exceptions cannot impersonate internal failure codes or leak a prefixed canary", async (t) => {
  const canary = "captured_count_private_secret_canary";
  const f = await execute(
    t,
    {},
    {
      fetcher: async () => {
        throw Error(canary);
      },
    },
  );
  assert.equal(f.result.failureCode, "captured_count_operation_failed");
  assert.equal(f.result.status, "COUNT_FAILED_ATTEMPT_CONSUMED");
  assert.doesNotMatch(JSON.stringify(f.result), /private_secret_canary/u);
  for (const name of await readdir(f.outputDirectory))
    assert.doesNotMatch(
      await readFile(join(f.outputDirectory, name), "utf8"),
      /private_secret_canary/u,
    );
});

test("redirects, oversized, malformed and invalid count responses fail closed", async (t) => {
  const redirected = json({ object: "response.input_tokens", input_tokens: 12 });
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const response of [
    redirected,
    new Response("x".repeat(32769), { headers: { "Content-Type": "application/json" } }),
    new Response("{bad", { headers: { "Content-Type": "application/json" } }),
    json({ object: "response.input_tokens", input_tokens: 8193 }),
    json({ object: "response", input_tokens: 12 }),
    json({ object: "response.input_tokens", input_tokens: "12" }),
    json({ object: "response.input_tokens", input_tokens: 0 }),
  ]) {
    const f = await execute(t, {}, { fetcher: async () => response });
    assert.equal(f.result.status, "COUNT_FAILED_ATTEMPT_CONSUMED");
    assert.equal(f.result.inputTokens, undefined);
    assert.equal(f.result.requestAttempts, 1);
  }
});

test("hanging transport and stream respect the shared request deadline", async (t) => {
  const keeper = setInterval(() => {}, 100);
  t.after(() => clearInterval(keeper));
  for (const fetcher of [
    () => new Promise(() => {}),
    async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      }),
  ]) {
    const f = await execute(t, {}, { fetcher, requestTimeoutMs: 10, totalTimeoutMs: 20 });
    assert.equal(f.result.failureCode, "captured_count_request_aborted");
    assert.equal(f.result.requestAttempts, 1);
  }
});

test("cancellation consumes reservation and does not contact provider when already aborted", async (t) => {
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  const f = await execute(
    t,
    {},
    {
      signal: aborted.signal,
      fetcher() {
        calls++;
        throw Error("must not contact");
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(f.result.requestAttempts, 0);
  assert.equal(f.result.attemptConsumed, true);
  assert.equal(f.result.failureCode, "captured_count_request_aborted");
});

test("external cancellation aborts a pending request without retry", async (t) => {
  const control = new AbortController();
  const f = await execute(
    t,
    {},
    {
      signal: control.signal,
      fetcher: async (_url, init) => {
        queueMicrotask(() => control.abort());
        assert.ok(init.signal instanceof AbortSignal);
        return new Promise(() => {});
      },
    },
  );
  assert.equal(f.result.failureCode, "captured_count_request_aborted");
  assert.equal(f.result.requestAttempts, 1);
});

test("CLI rejects insecure files, symlink paths and inactive scope without requests", async (t) => {
  const directory = await privateDirectory(t);
  const f = fixture();
  const capturePath = join(directory, "capture.json"),
    planPath = join(directory, "plan.json");
  await writeFile(capturePath, JSON.stringify(f.capture), { mode: 0o600 });
  await writeFile(planPath, JSON.stringify(f.plan), { mode: 0o600 });
  const argv = [
    "--count",
    "--capture",
    capturePath,
    "--plan",
    planPath,
    "--output-directory",
    directory,
  ];
  const env = {
    KOVA_REQUEST_COUNT_ENABLED: "true",
    AZURE_ENVIRONMENT: "staging",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    OPENAI_API_KEY: SECRET,
  };
  const deps = {
    now: () => NOW,
    fetcher() {
      throw Error("no network");
    },
  };
  await chmod(capturePath, 0o644);
  await assert.rejects(main(argv, env, deps), /captured_count_private_path_rejected/u);
  await chmod(capturePath, 0o600);
  await symlink(capturePath, join(directory, "linked.json"));
  await assert.rejects(
    main(
      argv.map((v) => (v === capturePath ? join(directory, "linked.json") : v)),
      env,
      deps,
    ),
    /private_path_rejected/u,
  );
  await assert.rejects(
    main(argv, { ...env, AZURE_ENVIRONMENT: "production" }, deps),
    /count_disabled/u,
  );
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith("attempt.json")),
    false,
  );
});

test("explicit CLI consumes an independently bound private capture without exposing it", async (t) => {
  const directory = await privateDirectory(t),
    f = fixture();
  const capturePath = join(directory, "capture.json"),
    planPath = join(directory, "plan.json");
  await writeFile(capturePath, JSON.stringify(f.capture), { mode: 0o600 });
  await writeFile(planPath, JSON.stringify(f.plan), { mode: 0o600 });
  const result = await main(
    ["--count", "--capture", capturePath, "--plan", planPath, "--output-directory", directory],
    {
      KOVA_REQUEST_COUNT_ENABLED: "true",
      AZURE_ENVIRONMENT: "staging",
      KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
      OPENAI_API_KEY: SECRET,
    },
    {
      now: () => NOW,
      fetcher: async () => json({ object: "response.input_tokens", input_tokens: 123 }),
    },
  );
  assert.equal(result.inputTokens, 123);
  assert.equal(result.evidenceKind, "synthetic-fixture");
  assert.doesNotMatch(JSON.stringify(result), /private fixture|synthetic-private/u);
});

test("validation snapshots input payload before asynchronous work", () => {
  const f = fixture();
  const result = validateCapturedRequest(f.capture, f.plan, NOW);
  f.capture.body.reasoning.effort = "altered";
  assert.equal(result.payload.reasoning.effort, "low");
});

test("directory replacement cannot redirect receipts outside the reserved private directory", async (t) => {
  const outputDirectory = await privateDirectory(t);
  const replacement = await privateDirectory(t);
  const moved = `${outputDirectory}-original`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  const input = { ...fixture(), outputDirectory, apiKey: SECRET };
  const result = await countCapturedRequest(input, {
    now: () => NOW,
    fetcher: async () => {
      await rename(outputDirectory, moved);
      await symlink(replacement, outputDirectory, "dir");
      return json({ object: "response.input_tokens", input_tokens: 123 });
    },
  });
  assert.equal(result.inputTokens, 123);
  assert.equal((await readdir(moved)).length, 2);
  assert.deepEqual(await readdir(replacement), []);
  await assert.rejects(countCapturedRequest(input, { now: () => NOW }), /private_path_rejected/u);
});

test("CLI failure exits nonzero while preserving its redacted consumed-attempt receipt", async (t) => {
  const directory = await privateDirectory(t),
    f = fixture();
  const capturePath = join(directory, "capture.json"),
    planPath = join(directory, "plan.json");
  await writeFile(capturePath, JSON.stringify(f.capture), { mode: 0o600 });
  await writeFile(planPath, JSON.stringify(f.plan), { mode: 0o600 });
  const hook = `Date.now=()=>${NOW};globalThis.fetch=async()=>{throw Error('captured_count_private_secret_canary');};`;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(hook)}`,
      "scripts/azure/count-captured-request.mjs",
      "--count",
      "--capture",
      capturePath,
      "--plan",
      planPath,
      "--output-directory",
      directory,
    ],
    {
      encoding: "utf8",
      timeout: 3000,
      env: {
        ...process.env,
        KOVA_REQUEST_COUNT_ENABLED: "true",
        AZURE_ENVIRONMENT: "staging",
        KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
        OPENAI_API_KEY: SECRET,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "COUNT_FAILED_ATTEMPT_CONSUMED");
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-provider|synthetic-private|private fixture|private_secret_canary/u,
  );
  const receipt = JSON.parse(
    await readFile(join(directory, `token-count-${f.capture.operationId}.receipt.json`), "utf8"),
  );
  assert.equal(receipt.attemptConsumed, true);
  assert.equal(receipt.failureCode, "captured_count_operation_failed");
});
