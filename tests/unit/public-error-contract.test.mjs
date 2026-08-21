import assert from "node:assert/strict";
import test from "node:test";

import { inspectPublicErrorContract } from "../../scripts/release/public-error-contract.mjs";

test("public API routes do not expose or log raw exception messages", () => {
  assert.deepEqual(inspectPublicErrorContract(), []);
});
