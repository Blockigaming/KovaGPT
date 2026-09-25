import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  checkCanonicalHistoryExtension,
  validateForwardExtension,
} from "../../scripts/release/canonical-history-decision.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("the pinned canonical snapshot remains intact before 26 auth migrations", () => {
  assert.deepEqual(checkCanonicalHistoryExtension(), {
    baselineMigrations: 157,
    forwardExtensions: 26,
  });
});

test("a forward migration cannot mask a changed historical body or an untracked SQL file", () => {
  const oldName = "20260901000000_original.sql";
  const newName = "20260902000000_kova_added.sql";
  const old = { order: 1, filename: oldName, timestamp: "20260901000000", sha256: sha256("old") };
  const next = { order: 2, filename: newName, timestamp: "20260902000000", sha256: sha256("new") };
  const baseline = { count: 1, migrations: [old] };
  const current = { count: 2, migrations: [old, next] };
  const bytes = (name) => Buffer.from(name === oldName ? "old" : "new");
  assert.doesNotThrow(() => validateForwardExtension(baseline, current, [oldName, newName], bytes));
  assert.throws(
    () =>
      validateForwardExtension(baseline, current, [oldName, newName], (name) =>
        Buffer.from(name === oldName ? "tampered" : "new"),
      ),
    /canonical_history_source_content_changed/u,
  );
  assert.throws(
    () =>
      validateForwardExtension(
        baseline,
        current,
        [oldName, newName, "20260903000000_extra.sql"],
        bytes,
      ),
    /canonical_history_source_set_changed/u,
  );
});
