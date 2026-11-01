import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import ts from "typescript";
import { createGitHubChatTools } from "../../src/lib/github-chat-read.server.mjs";
import { planAllowance } from "../../src/lib/plan-usage-policy.mjs";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";

// Run the real route and request adapter. Only authentication, stored account
// state, connector I/O and the provider network boundary use offline fixtures.
const seams = {
  "@tanstack/react-router": ["createFileRoute"],
  "@/lib/api-auth.server": [
    "optionalUser",
    "assertNotBanned",
    "getCallerTier",
    "assertFeatureEnabled",
    "enforceQuota",
  ],
  "@/lib/account-identity.server.mjs": ["readAccountIdentity"],
  "@/lib/google-tools.server": [
    "getGoogleToolContext",
    "TOOL_ACTIVITY",
    "WRITE_TOOL_NAMES",
    "runGoogleTool",
    "stagePendingAction",
  ],
  "@/integrations/connected-tools.server": ["getConnectedToolContext", "runConnectedTool"],
  "@/lib/ai/accounting.server": ["acquireGeneration", "finalizeGeneration", "hashGuestIp"],
  "@/lib/runtime-env.server": ["runtimeEnv"],
  "@/integrations/supabase/client.server": ["supabaseAdmin"],
};
const providerPath = resolve("src/lib/ai/provider.server.ts");
const compiled = await build({
  entryPoints: ["src/routes/api/chat.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  logLevel: "silent",
  plugins: [
    {
      name: "offline-connector-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) => {
          if (path === providerPath) return { path, namespace: "file" };
          if (path in seams) return { path, namespace: "offline" };
          if (path === "@/lib/ai/provider.server") return { path, namespace: "observed-provider" };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "offline" }, ({ path }) => ({
          contents: seams[path]
            .map(
              (name) =>
                `export const ${name}=globalThis.fixture[${JSON.stringify(path)}][${JSON.stringify(name)}];`,
            )
            .join("\n"),
        }));
        b.onLoad({ filter: /.*/, namespace: "observed-provider" }, () => ({
          contents: `import * as real from ${JSON.stringify(providerPath)};
          globalThis.prepareConnectorRequest=real.prepareChatResponsesRequest;
          export * from ${JSON.stringify(providerPath)};
          export const chatCompletions=(...args)=>globalThis.provider(...args);`,
        }));
      },
    },
  ],
});

const owner = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-10-31T00:00:00Z";
const rows = {
  github_accounts: [
    {
      id: "account-a",
      owner_id: owner,
      auth_type: "oauth",
      status: "connected",
      token_ciphertext: "encrypted-fixture",
      token_expires_at: null,
      updated_at: stamp,
    },
  ],
  github_installations: [
    { id: 8, owner_id: owner, account_id: "account-a", suspended_at: null, updated_at: stamp },
  ],
  github_repositories: [
    {
      id: 7,
      owner_id: owner,
      account_id: "account-a",
      installation_id: 8,
      full_name: "Owner/Repo",
      permissions: { pull: true },
      explicitly_granted: true,
      revoked_at: null,
      updated_at: stamp,
    },
  ],
};
const github = createGitHubChatTools({
  configured: () => true,
  guard: async () => {},
  rate: async () => true,
  decrypt: async () => "offline-fixture",
  db: {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        limit: async () => ({ data: rows[table], error: null }),
      };
      return q;
    },
  },
});
const tool = (await github.getContext(owner)).tools[0];
assert.ok(tool);
// Exercise all five actual Google read schemas alongside the granted GitHub schema.
const googleAst = ts.createSourceFile(
  "google-tools.server.ts",
  readFileSync("src/lib/google-tools.server.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let googleDefinitions;
function findGoogleTools(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(googleAst) === "READ_ONLY_TOOLS")
    googleDefinitions = node.initializer.getText(googleAst);
  ts.forEachChild(node, findGoogleTools);
}
findGoogleTools(googleAst);
assert.ok(googleDefinitions);
const googleTools = JSON.parse(JSON.stringify(vm.runInNewContext("(" + googleDefinitions + ")")));
assert.equal(googleTools.length, 5);
const call = {
  id: "call_read",
  type: "function",
  function: { name: "github_read", arguments: '{"repository":"owner/repo","operation":"readme"}' },
};
const receipt = (input, output) => ({
  prompt_tokens: input,
  completion_tokens: output,
  input_tokens_details: { cached_tokens: 10 },
  output_tokens_details: { reasoning_tokens: 20 },
});
const event = (body) => `data: ${JSON.stringify(body)}\n\n`;

function fixture(options = {}) {
  const acquisitions = [],
    settlements = [],
    providers = [],
    normalizedProviders = [],
    reads = [],
    logs = [],
    messageReservations = [];
  const abort = new AbortController();
  const env = {
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: "offline-fixture-provider-key",
    KOVA_IP_HASH_SECRET: "offline-fixture-hash-secret-at-least-32-bytes",
    KOVA_AUTH_MODE: "supabase",
    KOVA_REQUEST_CAPTURE_ENABLED: "false",
    KOVA_SPEECH_ENABLED: "false",
    ...options.env,
  };
  const backend = {
    from(table) {
      const result = () => ({
        data: table === "user_preferences" ? { settings: {} } : null,
        error: null,
      });
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        abortSignal: () => q,
        maybeSingle: async () => result(),
        then: (yes, no) => Promise.resolve(result()).then(yes, no),
      };
      return q;
    },
    rpc(name, args) {
      assert.equal(name, "try_consume_daily_message");
      assert.equal(args._user_id, owner);
      messageReservations.push(args);
      const result = { data: options.messageQuota !== false, error: null };
      const query = {
        abortSignal: () => query,
        then: (yes, no) => Promise.resolve(result).then(yes, no),
      };
      return query;
    },
  };
  const auth = {
    userId: "11111111-1111-4111-8111-111111111111",
    authProvider: "supabase",
    emailVerified: true,
    supabaseAdmin: backend,
    supabaseUser: backend,
  };
  const noop = async () => null;
  const denied = () => {
    throw new Error("Unexpected offline boundary");
  };
  const fixtures = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      optionalUser: async () => auth,
      assertNotBanned: noop,
      getCallerTier: async () => options.tier ?? "free",
      assertFeatureEnabled: noop,
      enforceQuota: noop,
    },
    "@/lib/account-identity.server.mjs": { readAccountIdentity: noop },
    "@/lib/google-tools.server": {
      getGoogleToolContext: async () =>
        options.googleTools
          ? { binding: { connectionId: "google-fixture" }, tools: googleTools }
          : null,
      TOOL_ACTIVITY: {},
      WRITE_TOOL_NAMES: new Set(),
      runGoogleTool: denied,
      stagePendingAction: denied,
    },
    "@/integrations/connected-tools.server": {
      getConnectedToolContext: async () => (options.noTools ? null : { tools: [tool] }),
      runConnectedTool: async (...args) => {
        reads.push(args);
        if (options.abortAfterRead) abort.abort();
        return (
          options.toolResult ?? { path: "README.md", content: "A real offline repository fixture." }
        );
      },
    },
    "@/lib/ai/accounting.server": {
      acquireGeneration: async (value) => {
        acquisitions.push(value);
        const daily = planAllowance(Number(env.KOVA_MAX_TOKENS_PER_USER_DAY ?? 50_000), value.plan);
        return options.rejection
          ? { rejection: options.rejection }
          : value.reservedTokens > daily
            ? { rejection: "daily_tokens" }
            : { eventId: "offline-usage-event" };
      },
      finalizeGeneration: async (value) => {
        settlements.push(value);
      },
      hashGuestIp: denied,
    },
    "@/lib/runtime-env.server": { runtimeEnv: (name) => env[name] },
    "@/integrations/supabase/client.server": { supabaseAdmin: backend },
  };
  const context = {
    fixture: fixtures,
    provider: async (body, init) => {
      providers.push(structuredClone(body));
      normalizedProviders.push(context.prepareConnectorRequest(body));
      assert.equal(acquisitions.length, 1, "Provider work must follow authoritative admission");
      assert.ok(!options.rejection);
      if (options.abortPlanning && !body.stream) {
        abort.abort();
        throw new DOMException("Cancelled", "AbortError");
      }
      if (!body.stream)
        return Response.json({
          choices: [
            {
              message: { role: "assistant", content: null, tool_calls: [call] },
              finish_reason: "tool_calls",
            },
          ],
          usage: options.planningUsage ?? receipt(100, 120),
        });
      if (options.finalStatus)
        return Response.json(
          { error: { message: "Offline rejection", type: "rate_limit_error" } },
          { status: options.finalStatus },
        );
      const frames =
        event({ choices: [{ delta: { content: "Read the repository fixture." } }] }) +
        event({ choices: [], usage: receipt(300, 200) }) +
        "data: [DONE]\n\n";
      return new Response(frames, { headers: { "Content-Type": "text/event-stream" } });
    },
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
    process: { env, platform: process.platform, cwd: process.cwd.bind(process) },
    console: Object.fromEntries(
      ["info", "warn", "error", "log"].map((key) => [key, (...args) => logs.push(args)]),
    ),
    fetch: denied,
  };
  vm.runInNewContext(compiled.outputFiles[0].text, context, {
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  return {
    acquisitions,
    settlements,
    providers,
    normalizedProviders,
    messageReservations,
    reads,
    logs,
    async post() {
      const response = await context.module.exports.Route.server.handlers.POST({
        request: new Request("https://kova.test/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "idempotency-key": "offline-generation-001",
          },
          body: JSON.stringify({
            mode: options.mode ?? "instant",
            messages: [
              { role: "user", content: "Read README.md in my connected GitHub repository." },
            ],
            user: { customInstructions: "FINAL_CONTEXT_FIXTURE" },
          }),
          signal: abort.signal,
        }),
      });
      const text = await response.text();
      return { response, text };
    },
  };
}

for (const mode of ["instant", "thinking"]) {
  test(`Free ${mode} reads a connector with two bounded provider calls inside the unchanged daily allowance`, async () => {
    const f = fixture({ mode });
    const { response, text } = await f.post();
    assert.equal(response.status, 200, text);
    assert.equal(f.reads.length, 1);
    assert.equal(f.providers.length, 2);
    assert.ok(f.acquisitions[0].reservedTokens <= 10_000);
    const boundedCost = f.normalizedProviders.reduce(
      (total, body) => total + estimateProviderInput(body).tokens + body.max_output_tokens,
      0,
    );
    assert.ok(boundedCost <= f.acquisitions[0].reservedTokens);
    assert.ok(
      f.providers[0].max_completion_tokens > 0 && f.providers[0].max_completion_tokens <= 1_024,
    );
    assert.ok(f.providers[1].max_completion_tokens > 0);
    assert.equal(f.providers[1].tools, undefined);
    assert.ok(JSON.stringify(f.providers[0].messages).includes("FINAL_CONTEXT_FIXTURE"));
    assert.ok(JSON.stringify(f.providers[1].messages).includes("FINAL_CONTEXT_FIXTURE"));
    assert.ok(!JSON.stringify(f.providers[0].messages).includes("PUNCTUATION RULE (STRICT)"));
    assert.ok(JSON.stringify(f.providers[1].messages).includes("PUNCTUATION RULE (STRICT)"));
    assert.equal(f.settlements.length, 1);
    assert.equal(f.settlements[0].status, "completed");
    assert.equal(f.settlements[0].inputTokens, 400);
    assert.equal(f.settlements[0].outputTokens, 320);
    assert.equal(f.settlements[0].cachedInputTokens, 20);
    assert.equal(f.settlements[0].reasoningTokens, 40);
  });
}

test("oversized source data is marked as an excerpt and tool-call identity survives", async () => {
  const f = fixture({ toolResult: { content: "Unicode source 👋🏽 ".repeat(10_000) } });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 2);
  const messages = f.providers[1].messages;
  const source = messages.find((message) => message.role === "tool");
  assert.equal(source.tool_call_id, "call_read");
  assert.equal(messages.find((message) => message.tool_calls)?.tool_calls[0].id, "call_read");
  const excerpt = JSON.parse(source.content);
  assert.equal(excerpt.source_excerpt_truncated, true);
  assert.match(excerpt.notice, /omitted source/);
  assert.ok(source.content.length < 24_000);
});

test("Free Thinking fits the real Gmail, Calendar, Drive and GitHub tool schemas together", async () => {
  const f = fixture({ mode: "thinking", googleTools: true });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers[0].tools.length, 6);
  assert.equal(f.providers.length, 2);
  assert.equal(f.reads.length, 1);
  assert.ok(f.acquisitions[0].reservedTokens <= 10_000);
  const maximum = f.normalizedProviders.reduce(
    (sum, body) => sum + estimateProviderInput(body).tokens + body.max_output_tokens,
    0,
  );
  assert.ok(maximum <= f.acquisitions[0].reservedTokens);
});

for (const code of ["daily_tokens", "monthly_tokens", "premium_period", "premium_quota"]) {
  test(`${code} is a non-retryable allowance rejection before provider or connector work`, async () => {
    const f = fixture({ rejection: code });
    const { response, text } = await f.post();
    const error = JSON.parse(text);
    assert.equal(response.status, 429);
    assert.equal(error.code, code);
    assert.equal(error.category, "quota_exceeded");
    assert.equal(error.retryable, false);
    assert.equal(f.providers.length, 0);
    assert.equal(f.reads.length, 0);
    assert.equal(f.settlements.length, 0);
  });
}

test("concurrency retains a retryable rate-limit response", async () => {
  const f = fixture({ rejection: "principal_concurrency" });
  const { response, text } = await f.post();
  const error = JSON.parse(text);
  assert.equal(response.status, 429);
  assert.equal(error.category, "rate_limit");
  assert.equal(error.retryable, true);
  assert.equal(f.providers.length, 0);
});

test("a smaller operator allowance is honored before admission and cannot be raised by connector planning", async () => {
  const f = fixture({ env: { KOVA_MAX_TOKENS_PER_USER_DAY: "1" } });
  const { response, text } = await f.post();
  assert.equal(response.status, 413, text);
  assert.equal(JSON.parse(text).code, "request_budget");
  assert.equal(f.acquisitions.length, 0);
  assert.equal(f.providers.length, 0);
});

test("a rejected final provider call retains already spent planning usage", async () => {
  const f = fixture({ finalStatus: 429 });
  const { response } = await f.post();
  assert.equal(response.status, 200); // Staged read activity requires an SSE error.
  assert.equal(f.providers.length, 2);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "aborted");
  assert.equal(f.settlements[0].inputTokens, 100);
  assert.equal(f.settlements[0].outputTokens, 120);
});

test("planning cancellation settles once and never starts a final provider request", async () => {
  const f = fixture({ abortPlanning: true });
  const { response } = await f.post();
  assert.equal(response.status, 499);
  assert.equal(f.providers.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "client_disconnected");
  assert.ok(
    f.settlements[0].inputTokens + f.settlements[0].outputTokens <=
      f.acquisitions[0].reservedTokens,
  );
});

test("an unexpectedly large planning usage receipt stops before connector reads and remains charged", async () => {
  const f = fixture({ planningUsage: receipt(100_000, 100) });
  const { response, text } = await f.post();
  assert.equal(response.status, 413, text);
  assert.equal(f.providers.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].inputTokens, 100_000);
  assert.equal(f.settlements[0].status, "aborted");
});

test("ordinary chat without connectors retains its single-call reservation", async () => {
  const f = fixture({ noTools: true });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 1);
  assert.equal(f.providers[0].stream, true);
  assert.equal(f.reads.length, 0);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].inputTokens, 300);
  assert.equal(f.settlements[0].outputTokens, 200);
});

test("cancellation after a connector read settles planning usage without a final request", async () => {
  const f = fixture({ abortAfterRead: true });
  const { response } = await f.post();
  assert.equal(response.status, 499);
  assert.equal(f.providers.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].inputTokens, 100);
  assert.equal(f.settlements[0].outputTokens, 120);
});

test("a missing planning usage receipt retains its bounded fallback instead of reporting zero spend", async () => {
  const f = fixture({ planningUsage: {} });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.settlements.length, 1);
  assert.ok(f.settlements[0].inputTokens > 300);
  assert.equal(f.settlements[0].outputTokens, f.providers[0].max_completion_tokens + 200);
  assert.ok(
    f.settlements[0].inputTokens + f.settlements[0].outputTokens <=
      f.acquisitions[0].reservedTokens,
  );
});

test("resolved Lite and Medium use the regular allowance; reasoning modes use Thinking", async () => {
  for (const [mode, thinking] of [
    ["instant", false],
    ["medium", false],
    ["thinking", true],
    ["high", true],
  ]) {
    const f = fixture({ tier: "plus", mode, noTools: true });
    const { response, text } = await f.post();
    assert.equal(response.status, 200, text);
    assert.deepEqual(JSON.parse(JSON.stringify(f.messageReservations)), [
      { _user_id: owner, _thinking: thinking, _regular_limit: 250, _thinking_limit: 50 },
    ]);
    const blocked = fixture({ tier: "plus", mode, noTools: true, messageQuota: false });
    const denied = await blocked.post();
    assert.equal(denied.response.status, 429);
    assert.equal(JSON.parse(denied.text).kind, thinking ? "thinking" : "regular");
    assert.equal(blocked.providers.length, 0);
  }
});

test("paid connector planning retains its existing hop and reservation policy", async () => {
  const f = fixture({ tier: "plus" });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 4);
  assert.equal(f.reads.length, 1); // Subsequent identical calls use the existing cache.
  assert.equal(f.providers[0].max_completion_tokens, undefined);
  assert.equal(f.providers.at(-1).stream, true);
  assert.equal(f.settlements.length, 1);
});

test("an already consumed generation identifier never causes a second provider request", async () => {
  const f = fixture({ rejection: "duplicate" });
  const { response, text } = await f.post();
  const error = JSON.parse(text);
  assert.equal(response.status, 409);
  assert.equal(error.category, "bad_request");
  assert.equal(error.retryable, false);
  assert.equal(f.providers.length, 0);
  assert.equal(f.reads.length, 0);
});
