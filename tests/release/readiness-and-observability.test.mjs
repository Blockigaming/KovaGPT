import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("liveness performs no dependency calls and readiness is bounded", async () => {
  const live = await read("src/routes/api/livez.ts"),
    ready = await read("src/lib/readiness.server.ts");
  assert.doesNotMatch(live, /fetch|supabase|provider/i);
  assert.match(ready, /AbortController/);
  assert.match(ready, /migration-required/);
  assert.match(ready, /rpc\/kovagpt_schema_health/);
});
test("public readiness never returns environment values or secrets", async () => {
  const s = await read("src/lib/readiness.server.ts");
  assert.doesNotMatch(s, /capabilities[^]*runtimeEnv\([^)]*\)\s*[,}]/);
  assert.match(s, /CapabilityState/);
});
test("structured logger rejects sensitive metadata keys and bounds output", async () => {
  const { sanitizeLog } = await import("../../src/lib/structured-log.server.ts");
  const out = sanitizeLog({
    correlationId: "x".repeat(100),
    category: "db",
    operation: "write",
    metadata: { token: "secret", prompt: "private", count: 2, safe: "x".repeat(500) },
  });
  assert.equal(out.correlationId.length, 64);
  assert.equal(out.metadata.token, undefined);
  assert.equal(out.metadata.prompt, undefined);
  assert.equal(out.metadata.count, 2);
  assert.equal(out.metadata.safe.length, 200);
});
