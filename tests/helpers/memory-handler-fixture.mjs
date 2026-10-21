import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as policy from "../../src/lib/chat-summary-policy.server.mjs";
import * as reviewedPolicy from "../../src/lib/reviewed-memory-policy.mjs";
import * as security from "../../src/lib/auth-security.mjs";

export function memoryHandlerFixture(options = {}) {
  const calls = [];
  const db = options.db ?? {};
  const modules = {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/api-auth.server": {
      requireUser: async () =>
        options.authResponse ?? {
          userId: "owner",
          supabaseAdmin: db,
          supabaseUser: options.userDb ?? db,
          emailVerified: options.verified !== false,
          revalidateSession: options.revalidateSession,
        },
      getCallerTier: async () => options.tier ?? "plus",
      assertNotBanned: async () => options.banned ?? null,
      assertFeatureEnabled: async () => options.feature ?? null,
    },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/reviewed-memory-policy.mjs": reviewedPolicy,
    "@/lib/auth-security.mjs": security,
    "@/lib/chat-summary-policy.server.mjs": policy,
    "@/lib/chat-summary.server": {
      beginChatMemoryWrite: async (...args) => {
        calls.push(["epoch", ...args]);
        return 7;
      },
      chatSummariesEnabled: () => options.enabled !== false,
      queueChatSummary: async (...args) => {
        calls.push(["queue", ...args]);
        if (options.queueError) throw new Error("queue unavailable");
      },
      persistChatMemory: async (...args) => {
        calls.push(["persist", ...args]);
        if (options.persistError) throw new Error("epoch invalidated");
        return { data: true, error: null };
      },
      readChatSummaryDescriptor: async (...args) => {
        calls.push(["descriptor", ...args]);
        return { enabled: true, descriptor: null };
      },
      deleteChatMemory: async (...args) => calls.push(["delete", ...args]),
    },
    ...options.modules,
  };
  const compiled = ts.transpileModule(readFileSync("src/routes/api/memory.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Response,
    AbortSignal,
    Request,
    URL,
    console,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  return { calls, handlers: exports.Route.server.handlers };
}
