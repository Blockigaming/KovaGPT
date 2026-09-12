import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { inspectVisibleControlContract } from "../../scripts/release/visible-control-contract.mjs";

test("visible product controls are backed or explicitly absent", () => {
  assert.deepEqual(inspectVisibleControlContract(), []);
});

test("visible-control audit tolerates a tracked file deleted before staging", () => {
  assert.deepEqual(
    inspectVisibleControlContract({ files: ["src/lib/deleted-before-stage.ts"] }),
    [],
  );
});

test("Voice remains required scope without advertising an unavailable implementation", async () => {
  const registry = await readFile(
    new URL("../../src/lib/capability-registry.ts", import.meta.url),
    "utf8",
  );
  assert.match(registry, /voiceScope: "required_unavailable"/u);
  assert.match(registry, /voice:[\s\S]*availability: "unavailable"/u);
  assert.doesNotMatch(registry, /Voice is intentionally outside/u);
});
