import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { MODEL_COST_PER_MTOK } from "../../src/lib/ai/model-config.mjs";

// Exercise the actual catalog functions with no process configuration or provider access.
const source = readFileSync("src/lib/ai/model-catalog.server.ts", "utf8");
const importLine = 'import { runtimeEnv } from "@/lib/runtime-env.server";';
assert.ok(source.includes(importLine));
const code = stripTypeScriptTypes(
  source.replace(importLine, "const runtimeEnv = () => undefined;"),
);
const catalog = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("standard text prices match official October 15 review in routing and accounting", () => {
  assert.equal(catalog.MODEL_CATALOG_VERSION, "2026-10-15");
  for (const [id, input, cachedInput, output] of [
    ["gpt-5.6-luna", 0.2, 0.02, 1.2],
    ["gpt-5.6-terra", 2, 0.2, 12],
    ["gpt-5.6-sol", 4, 0.4, 20],
  ]) {
    const model = catalog.OPENAI_TEXT_MODELS.find((entry) => entry.id === id);
    assert.deepEqual(model.pricePerMillion, { input, cachedInput, output });
    assert.deepEqual(MODEL_COST_PER_MTOK[id], { input, output });
    assert.equal(
      catalog.estimateMaximumCostUsd(model, 1000, 500),
      (1000 * input + 500 * output) / 1_000_000,
    );
    assert.equal(
      catalog.actualCostUsd(model, { input: 1000, cachedInput: 250, output: 500 }),
      (750 * input + 250 * cachedInput + 500 * output) / 1_000_000,
    );
  }
});
