import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, chmod, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  ACCEPTANCE_PROMPT,
  acceptanceDigest,
} from "../../src/lib/generation-acceptance.server.mjs";

// Execute the actual route, context readers, pure request adapter and private
// capture sink. Authentication and backend data are synthetic authority fixtures.
// Every provider, accounting, quota and connected-tool seam is observed/denied.
const MOCKS = {
  "@tanstack/react-router": ["createFileRoute"],
  "@/lib/api-auth.server": [
    "optionalUser",
    "assertNotBanned",
    "getCallerTier",
    "assertFeatureEnabled",
    "enforceQuota",
  ],
  "@/lib/account-identity.server.mjs": ["readAccountIdentity"],
  "@/lib/build-identity": ["BUILD_IDENTITY"],
  "@/lib/google-tools.server": [
    "getGoogleToolContext",
    "TOOL_ACTIVITY",
    "WRITE_TOOL_NAMES",
    "runGoogleTool",
    "stagePendingAction",
  ],
  "@/lib/ai/accounting.server": ["acquireGeneration", "finalizeGeneration", "hashGuestIp"],
  "@/lib/pricing/developer-billing.server": ["meterProviderRequest"],
  "@/lib/runtime-env.server": ["runtimeEnv"],
  "@/lib/distributed-rate-limit.server": ["consumeApplicationRateLimit"],
  "@/integrations/supabase/client.server": ["supabaseAdmin"],
  "@/lib/generation-acceptance-runtime.server": ["generationAcceptance"],
};
const providerPath = resolve("src/lib/ai/provider.server.ts");
const compiled = await build({
  entryPoints: ["src/routes/api/chat.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "capture-authority-fixtures",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === providerPath) return { path: providerPath, namespace: "file" };
          if (args.path in MOCKS) return { path: args.path, namespace: "authority-fixture" };
          if (args.path === "@/lib/ai/provider.server")
            return { path: args.path, namespace: "observed-real-provider" };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "authority-fixture" }, ({ path }) => ({
          contents: MOCKS[path]
            .map(
              (name) =>
                `export const ${name}=globalThis.fixture[${JSON.stringify(path)}][${JSON.stringify(name)}];`,
            )
            .join("\n"),
        }));
        b.onLoad({ filter: /.*/, namespace: "observed-real-provider" }, () => ({
          contents: [
            `import * as real from ${JSON.stringify(providerPath)};`,
            `export * from ${JSON.stringify(providerPath)};`,
            "globalThis.realProviderForCaptureTest = real;",
            ...["chatCompletions", "imageGenerations", "imageEdits", "embeddings"].map(
              (name) =>
                `export function ${name}(...args){globalThis.observedCalls.push(${JSON.stringify(name)});return real.${name}(...args);}`,
            ),
          ].join("\n"),
        }));
      },
    },
  ],
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const OPERATION = "44444444-4444-4444-8444-444444444444";
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PRIVATE_CONTEXT = "private-account-workspace-fixture-never-return-this";
const PRIVATE_PREFERENCE = "private-account-preference-fixture-never-log-this";
const FIXTURE_KEY = "fixture-provider-credential-never-reveal";

async function makeFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "kova-request-capture-flow-"));
  await chmod(directory, 0o700);
  const calls = [];
  const queries = [];
  const logs = [];
  const now = Date.now();
  const plan = {
    version: 1,
    operationId: OPERATION,
    ownerId: OWNER,
    chatId: CHAT,
    source: { commit: SOURCE_COMMIT, tree: SOURCE_TREE },
    authMode: "supabase",
    notBefore: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
    evidenceKind: "synthetic-fixture",
    ...options.plan,
  };
  const env = {
    AZURE_ENVIRONMENT: "staging",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: FIXTURE_KEY,
    ELEVENLABS_API_KEY: "fixture-voice-credential-never-reveal",
    KOVA_IP_HASH_SECRET: "fixture-existing-limiter-secret-never-reveal-0000",
    KOVA_INSTANT_MODEL: "gpt-5.6-luna",
    KOVA_MODEL_DEFAULT_CHAT: "gpt-5.6-luna",
    KOVA_GENERATION_DISABLED: "true",
    AI_GENERATION_ENABLED: "false",
    KOVA_SPEECH_ENABLED: "false",
    KOVA_AUTH_MODE: "supabase",
    KOVA_BUILD_SHA: SOURCE_COMMIT,
    KOVA_SOURCE_TREE: SOURCE_TREE,
    KOVA_GENERATION_ACCEPTANCE_ENABLED: "false",
    KOVA_REQUEST_CAPTURE_ENABLED: "true",
    KOVA_REQUEST_CAPTURE_PLAN: JSON.stringify(plan),
    KOVA_REQUEST_CAPTURE_PLAN_SHA256: acceptanceDigest(plan),
    KOVA_REQUEST_CAPTURE_DIRECTORY: directory,
    ...options.env,
  };
  const ownerId = options.ownerId ?? OWNER;
  const chatId = options.chatId ?? CHAT;
  const backend = {
    from(table) {
      const filters = [];
      const query = { table, filters, columns: null };
      queries.push(query);
      const result = () => {
        calls.push(`read:${table}`);
        if (options.backendError) return { data: null, error: new Error("private backend detail") };
        if (table === "chat_history_records")
          return {
            data: options.chatMissing
              ? null
              : {
                  owner_id: options.storedOwnerId ?? OWNER,
                  id: CHAT,
                  deleted_at: options.deleted ? "2026-01-01T00:00:00Z" : null,
                  payload: { id: CHAT, temporary: false, messages: [] },
                },
            error: null,
          };
        if (table === "user_preferences") return { data: { settings: {} }, error: null };
        if (table === "chat_custom_rules")
          return { data: [{ instructions: PRIVATE_CONTEXT, enabled: true }], error: null };
        if (table === "chat_pinned_files") return { data: [], error: null };
        if (table === "chat_memories")
          return {
            data: [
              {
                id: "memory-fixture",
                title: "Private fixture",
                summary: "Speech test private-account-memory-fixture",
                updated_at: "2026-10-20T00:00:00Z",
              },
            ],
            error: null,
          };
        return { data: null, error: null };
      };
      const q = {
        select(columns) {
          query.columns = columns;
          return q;
        },
        eq(field, value) {
          filters.push([field, value]);
          return q;
        },
        is(field, value) {
          filters.push([field, value]);
          return q;
        },
        in: () => q,
        order: () => q,
        limit: () => q,
        abortSignal: () => q,
        maybeSingle: async () => result(),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      for (const method of ["insert", "upsert", "update", "delete"]) {
        q[method] = () => {
          calls.push(`database-write:${method}`);
          throw new Error("Unexpected database write");
        };
      }
      return q;
    },
    rpc() {
      calls.push("database-rpc");
      throw new Error("Unexpected database RPC");
    },
  };
  const auth = {
    userId: ownerId,
    emailVerified: options.emailVerified ?? true,
    authProvider: options.authProvider ?? "supabase",
    supabaseAdmin: backend,
    supabaseUser: backend,
  };
  const denied =
    (name) =>
    (..._args) => {
      calls.push(name);
      throw new Error(`Unexpected ${name}`);
    };
  const noop = async () => null;
  const fixtures = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      optionalUser: async () => {
        calls.push("session");
        return options.unauthenticated ? null : auth;
      },
      assertNotBanned: noop,
      getCallerTier: async () => options.tier ?? "free",
      assertFeatureEnabled: noop,
      enforceQuota: denied("quota"),
    },
    "@/lib/account-identity.server.mjs": { readAccountIdentity: async () => null },
    "@/lib/build-identity": { BUILD_IDENTITY: { sha: SOURCE_COMMIT } },
    "@/lib/google-tools.server": {
      getGoogleToolContext: denied("connector-context"),
      TOOL_ACTIVITY: {},
      WRITE_TOOL_NAMES: new Set(),
      runGoogleTool: denied("connected-tool"),
      stagePendingAction: denied("pending-action"),
    },
    "@/lib/ai/accounting.server": {
      acquireGeneration: denied("acquire-usage"),
      finalizeGeneration: denied("finalize-usage"),
      hashGuestIp: denied("guest-identity"),
    },
    "@/lib/pricing/developer-billing.server": { meterProviderRequest: denied("developer-meter") },
    "@/lib/runtime-env.server": { runtimeEnv: (name) => env[name] },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: denied("rate-limit-claim"),
    },
    "@/integrations/supabase/client.server": { supabaseAdmin: backend },
    "@/lib/generation-acceptance-runtime.server": {
      generationAcceptance: {
        run: denied("generation-admission"),
        openAI: denied("generation-slot"),
      },
    },
  };
  const context = {
    fixture: fixtures,
    observedCalls: calls,
    module: { exports: {} },
    require: createRequire(import.meta.url),
    Request,
    Response,
    Headers,
    URL,
    AbortController,
    AbortSignal,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Buffer,
    Error,
    DOMException,
    crypto,
    setTimeout,
    clearTimeout,
    process: {
      env,
      getuid: process.getuid?.bind(process),
      cwd: process.cwd.bind(process),
      platform: process.platform,
    },
    console: Object.fromEntries(
      ["info", "warn", "error", "log"].map((key) => [key, (...args) => logs.push(args)]),
    ),
    fetch: denied("provider-http"),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, context, {
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  const body = {
    mode: "instant",
    chatId,
    user: { customInstructions: PRIVATE_PREFERENCE },
    timezone: "UTC",
    locale: "en-US",
    messages: [{ role: "user", content: ACCEPTANCE_PROMPT }],
    memoryStartIndex: 0,
    historyOffset: 0,
    ...options.body,
  };
  const headers = {
    "Content-Type": "application/json",
    "x-kova-request-capture": OPERATION,
    ...options.headers,
  };
  if (options.headerPresent === false) delete headers["x-kova-request-capture"];
  return {
    calls,
    queries,
    logs,
    directory,
    plan,
    providers: context.realProviderForCaptureTest,
    post: () =>
      context.module.exports.Route.server.handlers.POST({
        request: new Request("https://kova.test/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      }),
    artifact: async () => {
      for (const entry of await readdir(directory)) {
        try {
          const file = join(directory, entry);
          const parsed = JSON.parse(await readFile(file, "utf8"));
          if (parsed.body && parsed.bodySha256) return { parsed, file };
        } catch {
          // Exclusive attempt marker or partial output is not a capture artifact.
        }
      }
      return null;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

const SIDE_EFFECTS = new Set([
  "quota",
  "acquire-usage",
  "finalize-usage",
  "guest-identity",
  "developer-meter",
  "provider-http",
  "chatCompletions",
  "imageGenerations",
  "imageEdits",
  "embeddings",
  "generation-admission",
  "generation-slot",
  "rate-limit-claim",
  "database-rpc",
  "connector-context",
  "connected-tool",
  "pending-action",
]);
function assertNoSideEffects(f) {
  assert.deepEqual(
    f.calls.filter((call) => SIDE_EFFECTS.has(call) || call.startsWith("database-write:")),
    [],
    "capture must stop before provider, quota, accounting, admission, tool and database-write seams",
  );
}

test("authenticated capture uses actual context assembly and repaired adapter without generation or charging", async (t) => {
  const f = await makeFixture({
    headers: { Authorization: "Bearer fixture-session-credential-never-reveal" },
  });
  t.after(f.cleanup);
  const response = await f.post();
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const captured = await f.artifact();
  assert.ok(captured, "the body belongs only in the private capture artifact");
  const { parsed: artifact, file } = captured;
  assert.equal(artifact.evidenceKind, "synthetic-fixture");
  assert.equal(artifact.body.model, "gpt-5.6-luna");
  assert.equal(artifact.body.max_output_tokens, 64);
  assert.equal(artifact.body.stream, true);
  assert.equal(artifact.body.store, false);
  assert.equal(artifact.body.service_tier, "default");
  assert.deepEqual(artifact.body.input, [{ role: "user", content: ACCEPTANCE_PROMPT }]);
  assert.deepEqual(artifact.body.reasoning, { effort: "low", summary: "auto" });
  assert.match(artifact.body.instructions, new RegExp(PRIVATE_CONTEXT));
  assert.match(artifact.body.instructions, new RegExp(PRIVATE_PREFERENCE));
  assert.match(artifact.body.instructions, /timezone: UTC; locale: en-US/);
  assert.equal(artifact.bodySha256, acceptanceDigest(artifact.body));
  assert.equal(artifact.serializedUtf8Bytes, Buffer.byteLength(JSON.stringify(artifact.body)));
  assert.equal(
    artifact.serializedBodySha256,
    createHash("sha256").update(JSON.stringify(artifact.body)).digest("hex"),
  );
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  const ownedChatQuery = f.queries.find((q) => q.table === "chat_history_records");
  assert.ok(ownedChatQuery, "capture must read the actual principal-bound durable chat");
  assert.ok(
    ownedChatQuery.filters.some(([field, value]) => field === "owner_id" && value === OWNER),
  );
  assert.ok(ownedChatQuery.filters.some(([field, value]) => field === "id" && value === CHAT));
  assert.ok(
    ownedChatQuery.filters.some(([field, value]) => field === "deleted_at" && value === null),
  );
  const workspaceQuery = f.queries.find((q) => q.table === "chat_custom_rules");
  assert.ok(workspaceQuery, "the existing workspace reader must run");
  assert.ok(
    workspaceQuery.filters.some(([field, value]) => field === "owner_id" && value === OWNER),
  );
  assert.ok(workspaceQuery.filters.some(([field, value]) => field === "chat_id" && value === CHAT));
  assert.ok(
    f.calls.indexOf("read:chat_history_records") < f.calls.indexOf("read:chat_custom_rules"),
  );
  const serializedArtifact = JSON.stringify(artifact);
  const publicOutput = `${responseText}\n${JSON.stringify(f.logs)}`;
  for (const value of [
    PRIVATE_CONTEXT,
    PRIVATE_PREFERENCE,
    FIXTURE_KEY,
    "fixture-voice-credential-never-reveal",
    "fixture-existing-limiter-secret-never-reveal-0000",
    "fixture-session-credential-never-reveal",
  ]) {
    assert.ok(
      !publicOutput.includes(value),
      "HTTP response/logs must contain no private content or credentials",
    );
  }
  for (const value of [FIXTURE_KEY, "fixture-session-credential-never-reveal"])
    assert.ok(!serializedArtifact.includes(value), "capture must never include credentials");
  assertNoSideEffects(f);
});

test("capture preserves actual entitled account memory context without invoking helpers", async (t) => {
  const f = await makeFixture({
    tier: "plus",
    body: { user: { customInstructions: PRIVATE_PREFERENCE, rememberAcross: true } },
  });
  t.after(f.cleanup);
  const response = await f.post();
  assert.equal(response.status, 201, await response.text());
  const captured = await f.artifact();
  assert.match(captured.parsed.body.instructions, /private-account-memory-fixture/);
  assertNoSideEffects(f);
});

test("a second capture cannot overwrite the private artifact or fall through to generation", async (t) => {
  const f = await makeFixture();
  t.after(f.cleanup);
  assert.equal((await f.post()).status, 201);
  const captured = await f.artifact();
  const original = await readFile(captured.file, "utf8");
  const repeated = await f.post();
  assert.ok(repeated.status >= 400, "duplicate/unknown outcomes are never silently replayed");
  assert.equal(await readFile(captured.file, "utf8"), original);
  assertNoSideEffects(f);
});

for (const [name, options] of [
  [
    "default-off with an explicit capture header",
    { env: { KOVA_REQUEST_CAPTURE_ENABLED: undefined } },
  ],
  ["capture enabled without its operation header", { headerPresent: false }],
  ["malformed operation header", { headers: { "x-kova-request-capture": "not-an-operation" } }],
  ["wrong operation header", { headers: { "x-kova-request-capture": OTHER_OWNER } }],
  ["anonymous authentication", { unauthenticated: true }],
  ["unverified authentication", { emailVerified: false }],
  ["wrong authenticated owner", { ownerId: OTHER_OWNER }],
  ["wrong selected chat", { chatId: OTHER_OWNER }],
  ["wrong durable owner", { storedOwnerId: OTHER_OWNER }],
  ["missing durable chat", { chatMissing: true }],
  ["deleted durable chat", { deleted: true }],
  ["backend ownership read failure", { backendError: true }],
  ["authentication mode mismatch", { authProvider: "kova" }],
  [
    "expired plan",
    {
      plan: {
        notBefore: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    },
  ],
  ["generation enabled", { env: { KOVA_GENERATION_DISABLED: "false" } }],
  ["speech enabled", { env: { KOVA_SPEECH_ENABLED: "true" } }],
  ["generation acceptance enabled", { env: { KOVA_GENERATION_ACCEPTANCE_ENABLED: "true" } }],
  ["non-staging environment", { env: { AZURE_ENVIRONMENT: "production" } }],
  ["wrong text provider", { env: { KOVA_TEXT_PROVIDER: "azure_openai" } }],
  ["source tree mismatch", { env: { KOVA_SOURCE_TREE: "c".repeat(40) } }],
  ["plan hash mismatch", { env: { KOVA_REQUEST_CAPTURE_PLAN_SHA256: "0".repeat(64) } }],
  [
    "nested source fields",
    { plan: { source: { commit: SOURCE_COMMIT, tree: SOURCE_TREE, credential: FIXTURE_KEY } } },
  ],
  ["positive history offset", { body: { historyOffset: 1 } }],
  ["positive memory boundary", { body: { memoryStartIndex: 1 } }],
  ["non-instant request", { body: { mode: "thinking" } }],
  [
    "non-reviewed prompt",
    { body: { messages: [{ role: "user", content: "Generate an image." }] } },
  ],
  [
    "assistant history",
    {
      body: {
        messages: [
          { role: "assistant", content: "old reply" },
          { role: "user", content: ACCEPTANCE_PROMPT },
        ],
      },
    },
  ],
  ["temporary chat", { body: { temporary: true } }],
  ["explicit web tool", { body: { clientTool: "web_search" } }],
  ["project retrieval", { body: { projectId: OTHER_OWNER } }],
]) {
  test(`capture rejects ${name} before charging or provider work`, async (t) => {
    const f = await makeFixture(options);
    t.after(f.cleanup);
    const response = await f.post();
    const responseText = await response.text();
    assert.ok(response.status >= 400, `${name}: ${response.status}: ${responseText}`);
    assert.equal(await f.artifact(), null);
    assertNoSideEffects(f);
    assert.ok(!responseText.includes(PRIVATE_CONTEXT));
    assert.ok(!responseText.includes(PRIVATE_PREFERENCE));
    assert.ok(!JSON.stringify(f.logs).includes(FIXTURE_KEY));
  });
}

for (const [name, method, body] of [
  [
    "chat",
    "chatCompletions",
    {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: ACCEPTANCE_PROMPT }],
      stream: true,
    },
  ],
  ["native Responses", "developerResponses", { model: "gpt-5.6-luna", input: ACCEPTANCE_PROMPT }],
  ["image", "imageGenerations", { model: "gpt-image-1", prompt: "synthetic image fixture" }],
  [
    "embedding",
    "embeddings",
    { model: "text-embedding-3-small", input: "synthetic embedding fixture" },
  ],
]) {
  test(`capture-only host denies direct ${name} provider execution before metering or HTTP`, async (t) => {
    const f = await makeFixture({
      env: {
        KOVA_GENERATION_DISABLED: "false",
        AI_GENERATION_ENABLED: "true",
      },
    });
    t.after(f.cleanup);
    await assert.rejects(f.providers[method](body), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.message, "Provider execution is disabled during request capture.");
      return true;
    });
    assertNoSideEffects(f);
    assert.equal(await f.artifact(), null);
  });
}

const speechMocks = {
  "@tanstack/react-router": ["createFileRoute"],
  "@/lib/api-auth.server": ["requireVerifiedUser"],
  "@/lib/distributed-rate-limit.server": ["consumeApplicationRateLimit"],
  "@/lib/runtime-env.server": ["runtimeEnv"],
  "@/lib/speech.server.mjs": ["createSpeechHandler"],
  "@/lib/multimodal/image-source.server.mjs": ["assertImagePrincipal"],
  "@/lib/generation-acceptance-runtime.server": ["generationAcceptance"],
};
const compiledSpeech = await build({
  entryPoints: ["src/routes/api/speech.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "speech-capture-side-effect-observers",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          args.path in speechMocks ? { path: args.path, namespace: "speech-fixture" } : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "speech-fixture" }, ({ path }) => ({
          contents: speechMocks[path]
            .map(
              (name) =>
                `export const ${name}=globalThis.fixture[${JSON.stringify(path)}][${JSON.stringify(name)}];`,
            )
            .join("\n"),
        }));
      },
    },
  ],
});

for (const captureMode of ["true", "invalid-nonfalse-value"]) {
  test(`capture mode ${captureMode} denies actual speech route before credential/config/handler work`, async () => {
    const calls = [];
    const denied = (name) => () => {
      calls.push(name);
      throw new Error(`Unexpected ${name}`);
    };
    const fixture = {
      "@tanstack/react-router": { createFileRoute: () => (value) => value },
      "@/lib/api-auth.server": { requireVerifiedUser: denied("speech-authenticate") },
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: denied("speech-rate-limit"),
      },
      "@/lib/runtime-env.server": {
        runtimeEnv: (name) => {
          calls.push(`env:${name}`);
          if (name === "KOVA_REQUEST_CAPTURE_ENABLED") return captureMode;
          throw new Error("Unexpected speech configuration/credential read");
        },
      },
      "@/lib/speech.server.mjs": { createSpeechHandler: denied("speech-handler-construction") },
      "@/lib/multimodal/image-source.server.mjs": {
        assertImagePrincipal: denied("speech-principal"),
      },
      "@/lib/generation-acceptance-runtime.server": {
        generationAcceptance: { run: denied("speech-admission"), speech: denied("speech-slot") },
      },
    };
    const context = {
      fixture,
      module: { exports: {} },
      require: createRequire(import.meta.url),
      Request,
      Response,
      fetch: denied("speech-provider-http"),
    };
    vm.runInNewContext(compiledSpeech.outputFiles[0].text, context);
    const response = await context.module.exports.Route.server.handlers.POST({
      request: new Request("https://kova.test/api/speech", { method: "POST" }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(calls, ["env:KOVA_REQUEST_CAPTURE_ENABLED"]);
    const body = await response.json();
    assert.equal(body.code, "request_capture_denied");
  });
}
