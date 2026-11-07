import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import ts from "typescript";
import { createGitHubChatTools } from "../../src/lib/github-chat-read.server.mjs";
import { chatUsageWindows, planAllowance } from "../../src/lib/plan-usage-policy.mjs";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";
import { CONNECTION_FLOWS, canReadConnection } from "../../src/integrations/connection-flows.mjs";

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
  "@/lib/ai/accounting.server": [
    "acquireGeneration",
    "finalizeGeneration",
    "getGenerationTokenHeadroom",
    "hashGuestIp",
  ],
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
let googleWriteDefinitions;
function findGoogleTools(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(googleAst) === "READ_ONLY_TOOLS")
    googleDefinitions = node.initializer.getText(googleAst);
  if (ts.isVariableDeclaration(node) && node.name.getText(googleAst) === "WRITE_TOOLS")
    googleWriteDefinitions = node.initializer.getText(googleAst);
  ts.forEachChild(node, findGoogleTools);
}
findGoogleTools(googleAst);
assert.ok(googleDefinitions);
const googleTools = JSON.parse(JSON.stringify(vm.runInNewContext("(" + googleDefinitions + ")")));
assert.equal(googleTools.length, 5);
assert.ok(googleWriteDefinitions);
const googleWriteTools = JSON.parse(
  JSON.stringify(vm.runInNewContext("(" + googleWriteDefinitions + ")")),
).filter((entry) =>
  ["gmail_create_draft", "gmail_send", "calendar_create_event"].includes(entry.function.name),
);
const allGoogleTools = [...googleTools, ...googleWriteTools];
assert.equal(allGoogleTools.length, 8);

// Generate the actual Linear schema with the production context builder.
const connectedAst = ts.createSourceFile(
  "connected-tools.server.ts",
  readFileSync("src/integrations/connected-tools.server.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const contextBuilder = connectedAst.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "getConnectedToolContext",
);
assert.ok(contextBuilder);
const connectedExports = {};
const linkedAccount = {
  id: "linear-fixture",
  provider_id: "linear",
  account_label: "Offline Linear account",
  status: "connected",
  granted_scopes: ["read"],
  token_expires_at: null,
};
const accountQuery = {
  select: () => accountQuery,
  eq: () => accountQuery,
  is: () => accountQuery,
  order: () => accountQuery,
  limit: async () => ({ data: [linkedAccount], error: null }),
};
vm.runInNewContext(
  ts.transpileModule(contextBuilder.getText(connectedAst), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: connectedExports,
    supabaseAdmin: {},
    db: { from: () => accountQuery },
    accountColumns: "offline-fixture-columns",
    assertLockdownAllows: async () => {},
    configuredOAuthProviders: () => [{ id: "linear" }],
    CONNECTION_FLOWS,
    canReadConnection,
    githubChatTools: { getContext: async () => ({ tools: [tool] }) },
  },
);
const allConnectedTools = (await connectedExports.getConnectedToolContext(owner)).tools;
assert.equal(allConnectedTools.length, 2);
assert.ok(allConnectedTools.some((entry) => entry.function.name === "linear_search"));
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
      const paid = (options.tier ?? "free") !== "free";
      assert.equal(name, paid ? "try_consume_paid_message" : "try_consume_daily_message");
      assert.equal(args._user_id, owner);
      messageReservations.push(args);
      const result = {
        data: paid
          ? options.messageQuota !== false
            ? "allowed"
            : "five_hour"
          : options.messageQuota !== false,
        error: null,
      };
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
          ? {
              binding: { connectionId: "google-fixture" },
              tools: options.googleTools === "all" ? allGoogleTools : googleTools,
            }
          : null,
      TOOL_ACTIVITY: {},
      WRITE_TOOL_NAMES: new Set(),
      runGoogleTool: options.planningCalls
        ? async (...args) => {
            reads.push(args);
            return { results: [], count: 0 };
          }
        : denied,
      stagePendingAction: denied,
    },
    "@/integrations/connected-tools.server": {
      getConnectedToolContext: async () =>
        options.noTools
          ? null
          : { tools: options.connectedTools ?? (options.linear ? allConnectedTools : [tool]) },
      runConnectedTool: async (...args) => {
        reads.push(args);
        if (options.abortAfterRead) abort.abort();
        return (
          options.toolResult ?? { path: "README.md", content: "A real offline repository fixture." }
        );
      },
    },
    "@/lib/ai/accounting.server": {
      getGenerationTokenHeadroom: async ({ userId, plan }) => {
        assert.equal(userId, owner);
        assert.equal(plan, "free");
        if (options.headroomError) throw new Error("offline-headroom-unavailable");
        const daily = planAllowance(Number(env.KOVA_MAX_TOKENS_PER_USER_DAY ?? 50_000), plan);
        const monthly = planAllowance(Number(env.KOVA_MAX_TOKENS_PER_USER_MONTH ?? 500_000), plan);
        const dayRemaining = Math.max(0, daily - (options.usedToday ?? 0));
        const monthRemaining = Math.max(0, monthly - (options.usedMonth ?? 0));
        return {
          tokenLimit: Math.min(dayRemaining, monthRemaining),
          limitingQuota: dayRemaining <= monthRemaining ? "daily_tokens" : "monthly_tokens",
        };
      },
      acquireGeneration: async (value) => {
        acquisitions.push(value);
        const daily = planAllowance(Number(env.KOVA_MAX_TOKENS_PER_USER_DAY ?? 50_000), value.plan);
        return options.rejection
          ? { rejection: options.rejection }
          : value.reservedTokens + (options.usedToday ?? 0) > daily
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
    provider: async (body, init, scope, execution) => {
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
              message: {
                role: "assistant",
                content: null,
                tool_calls: options.planningCalls ?? [call],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: options.planningUsage ?? receipt(100, 120),
        });
      if (options.internalUsage && body.stream) {
        assert.equal(execution.mode, options.mode);
        execution.onUsage(options.internalUsage);
        if (options.failAfterInternalUsage) throw new Error("bounded-provider-failure");
      }
      if (options.finalStatus)
        return Response.json(
          { error: { message: "Offline rejection", type: "rate_limit_error" } },
          { status: options.finalStatus },
        );
      const frames =
        event({
          choices: [{ delta: { content: options.finalText ?? "Read the repository fixture." } }],
        }) +
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
            messages: options.messages ?? [
              {
                role: "user",
                content: options.prompt ?? "Read README.md in my connected GitHub repository.",
              },
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

test("a Free connector request fits the remaining allowance after an ordinary chat", async () => {
  const f = fixture({ googleTools: "all", linear: true, usedToday: 1_953 });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, `${text}; reserved=${f.acquisitions[0]?.reservedTokens}`);
  assert.ok(f.acquisitions[0].reservedTokens <= 8_047);
  assert.equal(f.providers[0].tools.length, 10);
  assert.equal(f.providers.length, 2);
  assert.equal(f.reads.length, 1);
  const maximum = f.normalizedProviders.reduce(
    (sum, body) => sum + estimateProviderInput(body).tokens + body.max_output_tokens,
    0,
  );
  assert.ok(maximum <= f.acquisitions[0].reservedTokens);
});

test("five minimal connector results fit after prior usage without losing any tool-call ID", async () => {
  const planningCalls = [
    ["gmail_search", { query: "kova-impossible-fixture", max_results: 1 }],
    ["calendar_list_events", { max_results: 1 }],
    ["drive_search", { query: "kova-impossible-fixture", max_results: 1 }],
    ["github_read", { repository: "owner/repo", operation: "readme" }],
    ["linear_search", { account_id: "linear-fixture", query: "kova-impossible-fixture" }],
  ].map(([name, args], index) => ({
    id: `call_${index}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  }));
  const f = fixture({ googleTools: "all", linear: true, usedToday: 1_953, planningCalls });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 2);
  assert.equal(f.reads.length, 5);
  assert.ok(f.acquisitions[0].reservedTokens <= 8_047);
  assert.deepEqual(
    f.providers[1].messages
      .filter((message) => message.role === "tool")
      .map((message) => message.tool_call_id),
    planningCalls.map((entry) => entry.id),
  );
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
  assert.equal(response.status, 429, text);
  assert.equal(JSON.parse(text).code, "daily_tokens");
  assert.equal(f.acquisitions.length, 0);
  assert.equal(f.providers.length, 0);
});

test("monthly headroom and exhausted daily allowance stop before any provider or connector read", async () => {
  for (const options of [{ usedMonth: 100_000 }, { usedToday: 10_000 }]) {
    const f = fixture(options);
    const { response, text } = await f.post();
    assert.equal(response.status, 429, text);
    assert.equal(JSON.parse(text).code, options.usedMonth ? "monthly_tokens" : "daily_tokens");
    assert.equal(f.acquisitions.length, 0);
    assert.equal(f.providers.length, 0);
    assert.equal(f.reads.length, 0);
  }
});

test("a failed headroom read never admits or starts a generation", async () => {
  const f = fixture({ headroomError: true });
  const { response, text } = await f.post();
  assert.equal(response.status, 503, text);
  assert.equal(JSON.parse(text).code, "chat_preflight_failed");
  assert.equal(f.acquisitions.length, 0);
  assert.equal(f.providers.length, 0);
  assert.equal(f.reads.length, 0);
});

test("a concurrent reservation can still reject a positive headroom hint before provider work", async () => {
  const f = fixture({ usedToday: 1_953, googleTools: "all", rejection: "daily_tokens" });
  const { response, text } = await f.post();
  assert.equal(response.status, 429, text);
  assert.equal(f.acquisitions.length, 1);
  assert.ok(f.acquisitions[0].reservedTokens <= 8_047);
  assert.equal(f.providers.length, 0);
  assert.equal(f.reads.length, 0);
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

const oversizedCatalog = [
  {
    ...tool,
    function: { ...tool.function, description: "Permitted connector schema. ".repeat(15000) },
  },
];
const ordinaryFollowUp = [
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hi! How can I help?" },
  { role: "user", content: "What is 12 times 13? Answer briefly." },
];

test("ordinary Free follow-ups survive an oversized optional connector catalog with one metered Responses call", async () => {
  const f = fixture({
    connectedTools: oversizedCatalog,
    messages: ordinaryFollowUp,
    finalText: "156",
  });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.ok(text.includes("156"));
  assert.equal(f.providers.length, 1);
  assert.equal(f.providers[0].stream, true);
  assert.equal(f.providers[0].tools, undefined);
  assert.equal(f.reads.length, 0);
  assert.equal(f.acquisitions.length, 1);
  const normalized = f.normalizedProviders[0];
  assert.ok(
    estimateProviderInput(normalized).tokens + normalized.max_output_tokens <=
      f.acquisitions[0].reservedTokens,
  );
  assert.ok(f.acquisitions[0].reservedTokens <= 10000);
  const sent = JSON.stringify(f.providers[0].messages);
  for (const message of ordinaryFollowUp) assert.ok(sent.includes(message.content));
  assert.ok(sent.includes("FINAL_CONTEXT_FIXTURE"));
  assert.ok(sent.includes("Connected tools were not run"));
  assert.ok(sent.includes("Never invent retrieved data or claim an action succeeded"));
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].inputTokens, 300);
  assert.equal(f.settlements[0].outputTokens, 200);
});

test("the ordinary fallback still obeys the authoritative account quota and operator cost ceiling", async () => {
  const quota = fixture({
    connectedTools: oversizedCatalog,
    messages: ordinaryFollowUp,
    rejection: "daily_tokens",
  });
  const q = await quota.post();
  assert.equal(q.response.status, 429, q.text);
  assert.equal(JSON.parse(q.text).code, "daily_tokens");
  assert.equal(quota.acquisitions.length, 1);
  assert.equal(quota.providers.length, 0);
  assert.equal(quota.reads.length, 0);
  const cost = fixture({
    connectedTools: oversizedCatalog,
    messages: ordinaryFollowUp,
    env: { KOVA_MAX_COST_USD_PER_REQUEST: "0.000001" },
  });
  const c = await cost.post();
  assert.equal(c.response.status, 413, c.text);
  assert.equal(JSON.parse(c.text).code, "request_budget");
  assert.equal(cost.acquisitions.length, 0);
  assert.equal(cost.providers.length, 0);
  assert.equal(cost.reads.length, 0);
});

for (const mode of ["instant", "default"]) {
  for (const connectors of [false, true]) {
    test(`Free ${mode} fits a short reply into remaining daily headroom${connectors ? " after optional connector fallback" : " without connectors"}`, async () => {
      const f = fixture({
        mode,
        noTools: !connectors,
        ...(connectors ? { connectedTools: oversizedCatalog } : {}),
        messages: ordinaryFollowUp,
        usedToday: 5_799,
        finalText: "156",
        env: {
          KOVA_HOSTED_INFERENCE_ENABLED: "true",
          OPENROUTER_API_KEY: "offline-fixture-hosted-key",
          KOVA_MODEL_DEFAULT_CHAT: "kova-argon-4.6",
        },
      });
      const { response, text } = await f.post();
      assert.equal(response.status, 200, text);
      assert.ok(text.includes("156"));
      assert.equal(f.providers.length, 1);
      assert.equal(f.providers[0].model, "kova-argon-4.6");
      assert.equal(f.reads.length, 0);
      assert.equal(f.acquisitions.length, 1);
      assert.ok(f.acquisitions[0].reservedTokens <= 4_201);
      const normalized = f.normalizedProviders[0];
      const output = normalized.max_tokens;
      assert.ok(output > 0);
      assert.ok(output < (mode === "instant" ? 1_200 : 4_000));
      assert.ok(
        estimateProviderInput(normalized).tokens + output <= f.acquisitions[0].reservedTokens,
      );
      const sent = JSON.stringify(f.providers[0].messages);
      for (const message of ordinaryFollowUp) assert.ok(sent.includes(message.content));
      assert.ok(sent.includes("FINAL_CONTEXT_FIXTURE"));
      assert.equal(sent.includes("Connected tools were not run"), connectors);
      assert.equal(f.settlements.length, 1);
      assert.equal(f.settlements[0].status, "completed");
    });
  }
}

test("single-call Free replies honor monthly headroom, require complete input, and fail closed on usage read failure", async () => {
  const monthly = fixture({
    noTools: true,
    mode: "default",
    usedMonth: 95_799,
    messages: ordinaryFollowUp,
  });
  const m = await monthly.post();
  assert.equal(m.response.status, 200, m.text);
  assert.ok(monthly.acquisitions[0].reservedTokens <= 4_201);

  const exhausted = fixture({ noTools: true, usedToday: 9_999 });
  const e = await exhausted.post();
  assert.equal(e.response.status, 429, e.text);
  assert.equal(JSON.parse(e.text).code, "daily_tokens");
  assert.equal(exhausted.acquisitions.length, 0);
  assert.equal(exhausted.providers.length, 0);

  const unavailable = fixture({ noTools: true, headroomError: true });
  const u = await unavailable.post();
  assert.equal(u.response.status, 503, u.text);
  assert.equal(unavailable.acquisitions.length, 0);
  assert.equal(unavailable.providers.length, 0);
});

test("a shorter Free reply still requires atomic admission after its headroom read", async () => {
  const f = fixture({
    noTools: true,
    mode: "default",
    usedToday: 5_799,
    rejection: "daily_tokens",
  });
  const { response, text } = await f.post();
  assert.equal(response.status, 429, text);
  assert.equal(JSON.parse(text).code, "daily_tokens");
  assert.equal(f.acquisitions.length, 1);
  assert.ok(f.acquisitions[0].reservedTokens <= 4_201);
  assert.equal(f.providers.length, 0);
});

for (const prompt of [
  "Hi",
  "Reply exactly: KovaGPT production chat verified.",
  "Reply with exactly: KOVA_CHAT_OK",
  "What is 2 + 2?",
  "Compute -2.5 * 4",
]) {
  test(`self-contained turn avoids connector planning with connected accounts: ${prompt}`, async () => {
    const f = fixture({ prompt, googleTools: "all", linear: true });
    const { response, text } = await f.post();
    assert.equal(response.status, 200, text);
    assert.equal(f.providers.length, 1);
    assert.equal(f.providers[0].stream, true);
    assert.equal(f.providers[0].tools, undefined);
    assert.equal(f.reads.length, 0);
    assert.equal(f.acquisitions.length, 1);
    assert.equal(f.settlements.length, 1);
  });
}

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

test("resolved Lite uses regular allowance; Medium and higher modes use Thinking", async () => {
  for (const [mode, thinking] of [
    ["instant", false],
    ["medium", true],
    ["thinking", true],
    ["high", true],
  ]) {
    const f = fixture({ tier: "plus", mode, noTools: true });
    const { response, text } = await f.post();
    assert.equal(response.status, 200, text);
    const windows = chatUsageWindows("plus");
    const weekly = windows.find(({ id }) => id === "weekly");
    const short = windows.find(({ id }) => id === "five_hour");
    assert.deepEqual(JSON.parse(JSON.stringify(f.messageReservations)), [
      {
        _user_id: owner,
        _thinking: thinking,
        _weekly_limit: thinking ? weekly.thinkingLimit : weekly.regularLimit,
        _short_limit: thinking ? short.thinkingLimit : short.regularLimit,
      },
    ]);
    const blocked = fixture({ tier: "plus", mode, noTools: true, messageQuota: false });
    const denied = await blocked.post();
    assert.equal(denied.response.status, 429);
    assert.equal(JSON.parse(denied.text).kind, thinking ? "thinking" : "regular");
    assert.equal(blocked.providers.length, 0);
  }
});

test("paid connector planning retains its existing hop and reservation policy", async () => {
  const f = fixture({ tier: "plus", headroomError: true });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 4);
  assert.equal(f.reads.length, 1); // Subsequent identical calls use the existing cache.
  assert.equal(f.providers[0].max_completion_tokens, f.providers.at(-1).max_completion_tokens);
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

const hostedRouting = {
  KOVA_HOSTED_INFERENCE_ENABLED: "true",
  KOVA_MODEL_DEFAULT_CHAT: "kova-argon-4.6",
  KOVA_MODEL_ADVANCED_REASONING: "kova-neon-4.6",
  KOVA_MODEL_PREMIUM_REASONING: "kova-xenon-5",
};
for (const [tier, mode, alias, foundation] of [
  ["free", "instant", "kova-argon-4.6", "deepseek/deepseek-v4-flash-0731"],
  ["plus", "thinking", "kova-neon-4.6", "meta-llama/llama-4-maverick"],
  ["pro", "max", "kova-xenon-5", "moonshotai/kimi-k3"],
]) {
  test(`actual chat route admits ${alias} with its selected model and unchanged account admission`, async () => {
    const f = fixture({ tier, mode, noTools: true, env: hostedRouting });
    const { response, text } = await f.post();
    assert.equal(response.status, 200, text);
    assert.equal(f.providers.length, 1);
    assert.equal(f.providers[0].model, alias);
    assert.equal(f.normalizedProviders[0].model, foundation);
    assert.equal(f.acquisitions.length, 1);
    assert.equal(f.settlements.length, 1);
    assert.equal(f.reads.length, 0);
  });
}

test("Argon connector fallback retains the selected hosted model and complete conversation", async () => {
  const f = fixture({
    connectedTools: oversizedCatalog,
    messages: ordinaryFollowUp,
    env: hostedRouting,
  });
  const { response, text } = await f.post();
  assert.equal(response.status, 200, text);
  assert.equal(f.providers.length, 1);
  assert.equal(f.normalizedProviders[0].model, "deepseek/deepseek-v4-flash-0731");
  const sent = JSON.stringify(f.normalizedProviders[0].messages);
  for (const message of ordinaryFollowUp) assert.ok(sent.includes(message.content));
  assert.ok(sent.includes("Connected tools were not run"));
  assert.equal(f.reads.length, 0);
  assert.equal(f.acquisitions.length, 1);
  assert.equal(f.settlements.length, 1);
});

for (const outcome of ["success", "network_failure", "http_rejection"]) {
  test(`Ultra actual handler retains review usage on ${outcome}`, async () => {
    const f = fixture({
      tier: "pro",
      mode: "ultra",
      noTools: true,
      env: hostedRouting,
      internalUsage: { input: 600, output: 200, cachedInput: 10, reasoning: 50 },
      failAfterInternalUsage: outcome === "network_failure",
      ...(outcome === "http_rejection" ? { finalStatus: 429 } : {}),
    });
    const { response, text } = await f.post();
    assert.equal(f.acquisitions.length, 1, text);
    assert.equal(f.settlements.length, 1, text);
    const settlement = f.settlements[0];
    assert(settlement.inputTokens >= 600);
    assert(settlement.outputTokens >= 200);
    assert(settlement.reasoningTokens >= 50);
    assert.equal(settlement.status, outcome === "success" ? "completed" : "aborted");
    if (outcome === "success") {
      assert.equal(response.status, 200, text);
      assert.equal(settlement.inputTokens, 900);
      assert.equal(settlement.outputTokens, 400);
    }
  });
}
