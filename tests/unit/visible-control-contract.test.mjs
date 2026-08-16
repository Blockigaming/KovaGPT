import assert from "node:assert/strict";
import test from "node:test";

import { inspectVisibleControlContract } from "../../scripts/release/visible-control-contract.mjs";

test("visible product controls are backed or explicitly absent", () => {
  assert.deepEqual(inspectVisibleControlContract(), []);
});
