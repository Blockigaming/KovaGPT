import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const source = await readFile("src/hooks/useTier.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
async function tier(summary) {
  const state = [];
  const context = {
    useState: (value) => {
      const index = state.length;
      state.push(value);
      return [
        value,
        (next) => {
          state[index] = next;
        },
      ];
    },
    useEffect: (fn) => fn(),
    getSupabaseClientConfigStatus: () => ({ configured: true }),
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "fixture" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      rpc: async (name) => {
        assert.equal(name, "current_subscription_summary");
        return { data: summary, error: null };
      },
    },
  };
  vm.runInNewContext(`${compiled}\nuseTier();`, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state[1], false);
  return state[0];
}
test("duplicate same-tier billing alerts do not override the database's paid entitlement", async () => {
  assert.equal(await tier({ effectiveTier: "plus", billingConflict: true }), "plus");
  assert.equal(await tier({ effectiveTier: "pro", billingConflict: true }), "pro");
});
test("ambiguous or malformed database entitlement remains free", async () => {
  assert.equal(await tier({ effectiveTier: "free", billingConflict: true }), "free");
  assert.equal(await tier({ effectiveTier: "unknown", billingConflict: false }), "free");
});
