function assertRevision(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

/**
 * Durable history may replace the opening payload only when no local edit has
 * occurred since that history request started. Comparing document strings is
 * insufficient because an edit followed by an intentional revert is still a
 * user decision that the late request must preserve.
 */
export function canApplyLoadedArtifactHistory(loadRevision, currentRevision) {
  assertRevision(loadRevision, "loadRevision");
  assertRevision(currentRevision, "currentRevision");
  return loadRevision === currentRevision;
}

/**
 * Invalidates a failed autosave only when it still represents the most recent
 * scheduled snapshot for the current Canvas session. A cancelled UI effect may
 * still own an in-flight write, so callers use retryCurrentValue to re-evaluate
 * the visible document after that write fails.
 */
export function recoverFailedArtifactSnapshot({
  failedSnapshot,
  scheduledSnapshot,
  durableSnapshot,
  generation,
  currentGeneration,
  effectCancelled,
}) {
  if (generation !== currentGeneration || scheduledSnapshot !== failedSnapshot) {
    return { scheduledSnapshot, retryCurrentValue: false };
  }
  return {
    scheduledSnapshot: durableSnapshot,
    retryCurrentValue: Boolean(effectCancelled),
  };
}
