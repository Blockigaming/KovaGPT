import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

function fixture(name) {
  const calls = [];
  const dependencies = {
    chatCompletions: async (body, init) => {
      calls.push({ body, init });
      return Response.json({
        choices: [
          {
            message: {
              content:
                name === "project-suggest"
                  ? '{"name":"Synthetic Project","description":"Synthetic description."}'
                  : "Synthetic result",
            },
          },
        ],
      });
    },
    missingAiProviderResponse: () => null,
    modelForRole: () => "gpt-5.6-luna",
    UTILITY_MAX_OUTPUT_TOKENS: 256,
    readUtilityCache: () => null,
    writeUtilityCache() {},
  };
  const source = stripTypeScriptTypes(readFileSync("src/routes/api/" + name + ".ts", "utf8"), {
    mode: "strip",
  })
    .replace(/^import\b[\s\S]*?;[ \t]*$/gmu, "")
    .replace(/^export\s+const /gmu, "const ")
    .replace(/import\("[^"]+"\)/gu, "Promise.resolve(__dependencies)");
  const context = vm.createContext({
    Request,
    Response,
    Headers,
    AbortController,
    DOMException,
    __dependencies: dependencies,
    ...dependencies,
    createFileRoute: () => (route) => route,
    resolveAnonymousClientKey: () => "synthetic-client",
    consumeApplicationRateLimit: async () => ({ allowed: true }),
    requireUser: async () => ({ userId: "synthetic-owner" }),
    assertNotBanned: async () => null,
    assertFeatureEnabled: async () => null,
    getCallerTier: async () => "free",
    enforceQuota: async () => null,
    DAILY_CHAT_LIMIT_BY_TIER: { free: 50 },
    providerErrorFromResponse: async () => new Error("synthetic-provider-failure"),
    providerErrorResponse: () =>
      Response.json({ error: "synthetic-provider-failure" }, { status: 502 }),
  });
  vm.runInContext(source + "\nglobalThis.handler = Route.server.handlers.POST;", context);
  return { handler: context.handler, calls };
}

for (const [name, body] of [
  ["title", { messages: [{ role: "user", content: "Synthetic title input" }] }],
  ["write", { text: "Synthetic text", action: "grammar" }],
  ["project-suggest", { hint: "Synthetic idea" }],
]) {
  test("/api/" + name + " binds its single utility call to caller cancellation", async () => {
    const f = fixture(name);
    const controller = new AbortController();
    const request = new Request("https://synthetic.example/api/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const response = await f.handler({ request });
    assert.equal(response.status, 200);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init?.signal, request.signal);
    controller.abort();
    assert.equal(f.calls[0].init.signal.aborted, true);
    assert.equal(f.calls[0].body.model, "gpt-5.6-luna");
  });
}
