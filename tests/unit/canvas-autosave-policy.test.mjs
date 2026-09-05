import assert from "node:assert/strict";
import test from "node:test";

import {
  canApplyLoadedArtifactHistory,
  recoverFailedArtifactSnapshot,
} from "../../src/lib/canvas-autosave-policy.mjs";

test("late Canvas history never replaces an edit that was intentionally reverted", () => {
  const loadRevision = 0;
  let currentRevision = loadRevision;
  currentRevision += 1; // edit away from initialContent
  currentRevision += 1; // intentionally revert to initialContent

  assert.equal(canApplyLoadedArtifactHistory(loadRevision, currentRevision), false);
  assert.equal(canApplyLoadedArtifactHistory(loadRevision, loadRevision), true);
});

test("a cancelled failed latest snapshot is invalidated and retried", () => {
  assert.deepEqual(
    recoverFailedArtifactSnapshot({
      failedSnapshot: "B",
      scheduledSnapshot: "B",
      durableSnapshot: "A",
      generation: 3,
      currentGeneration: 3,
      effectCancelled: true,
    }),
    { scheduledSnapshot: "A", retryCurrentValue: true },
  );
});

test("a failed older snapshot cannot invalidate a newer scheduled edit", () => {
  assert.deepEqual(
    recoverFailedArtifactSnapshot({
      failedSnapshot: "B",
      scheduledSnapshot: "C",
      durableSnapshot: "A",
      generation: 3,
      currentGeneration: 3,
      effectCancelled: true,
    }),
    { scheduledSnapshot: "C", retryCurrentValue: false },
  );
});

test("a closed or replaced Canvas cannot schedule retries", () => {
  assert.deepEqual(
    recoverFailedArtifactSnapshot({
      failedSnapshot: "B",
      scheduledSnapshot: "B",
      durableSnapshot: "A",
      generation: 3,
      currentGeneration: 4,
      effectCancelled: true,
    }),
    { scheduledSnapshot: "B", retryCurrentValue: false },
  );
});
