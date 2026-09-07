import assert from "node:assert/strict";
import test from "node:test";

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
