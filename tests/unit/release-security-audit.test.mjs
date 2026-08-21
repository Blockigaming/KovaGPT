import assert from "node:assert/strict";
import test from "node:test";

import { runReleaseSecurityAudit } from "../../scripts/release/security.mjs";

test("tracked source and present build output contain no exposed release secret or debug artifact", () => {
  assert.deepEqual(runReleaseSecurityAudit(), []);
});
