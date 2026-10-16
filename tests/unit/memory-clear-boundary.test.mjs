import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
function fixture() {
  const calls = [],
    env = {};
  const auth = {};
  const { memoryClearAvailability, changeMemoryClear } = loadUiModule(
    "src/lib/memory-clear.functions.ts",
    {
      "@tanstack/react-start": {
        createServerFn: () => {
          let validator;
          return {
            middleware(list) {
              assert.equal(list[0], auth);
              return this;
            },
            inputValidator(v) {
              validator = v;
              return this;
            },
            handler(fn) {
              return (data) =>
                fn({
                  context: { userId: "authenticated-owner" },
                  data: validator ? validator.parse(data) : data,
                });
            },
          };
        },
      },
      zod: { z },
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: auth },
      "@/integrations/supabase/client.server": { supabaseAdmin: {} },
      "@/lib/runtime-env.server": { runtimeEnv: (key) => env[key] },
      "@/lib/supabase-loose": {
        loose: () => ({
          rpc: (name, args) => {
            calls.push({ name, args });
            return {
              abortSignal: async () => ({
                data:
                  name === "memory_clear_capability"
                    ? 1
                    : {
                        operationId: args.p_operation_id,
                        state: "restored",
                        removedCount: 2,
                        restoredCount: 2,
                        skippedCount: 0,
                        expiresAt: "2026-10-13T12:00:00Z",
                      },
                error: null,
              }),
            };
          },
        }),
      },
    },
    { AbortSignal },
  );
  return { calls, env, memoryClearAvailability, changeMemoryClear };
}
const id = "11111111-1111-4111-8111-111111111111";
test("new clear fails closed without explicit retention and cleanup; existing recovery still works", async () => {
  const f = fixture();
  assert.equal((await f.memoryClearAvailability()).available, false);
  await assert.rejects(f.changeMemoryClear({ operationId: id, action: "clear" }), /not configured/);
  assert.equal(f.calls.length, 0);
  await f.changeMemoryClear({ operationId: id, action: "restore" });
  assert.equal(f.calls[0].args.p_user_id, "authenticated-owner");
  f.env.KOVA_MEMORY_UNDO_TTL_SECONDS = "600";
  assert.equal((await f.memoryClearAvailability()).available, false);
  f.env.KOVA_MEMORY_UNDO_CLEANUP_CONFIGURED = "true";
  assert.equal((await f.memoryClearAvailability()).available, true);
  await f.changeMemoryClear({ operationId: id, action: "clear" });
  assert.equal(f.calls.at(-1).args.p_ttl_seconds, 600);
});
test("browser cannot inject a principal, NULL conflict decision, or malformed operation identity", () => {
  const f = fixture();
  for (const data of [
    { operationId: id, action: "restore", userId: "someone-else" },
    { operationId: id, action: "restore", keepNewer: null },
    { operationId: "bad", action: "clear" },
  ])
    assert.throws(() => f.changeMemoryClear(data));
  assert.equal(f.calls.length, 0);
});
