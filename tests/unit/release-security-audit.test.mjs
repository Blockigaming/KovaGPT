import assert from "node:assert/strict";
import test from "node:test";

import { runReleaseSecurityAudit } from "../../scripts/release/security.mjs";

test("tracked source and present build output contain no exposed release secret or debug artifact", () => {
  assert.deepEqual(runReleaseSecurityAudit(), []);
});

test("security audit tolerates a tracked file deleted before staging", () => {
  assert.deepEqual(runReleaseSecurityAudit({ files: ["src/lib/deleted-before-stage.ts"] }), []);
});
