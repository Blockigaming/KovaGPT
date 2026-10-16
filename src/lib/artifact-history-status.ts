/** Presentation only: capability alone never acknowledges a saved draft. */
export function artifactHistoryStatus({
  canPersist,
  ready,
  hasSavedVersions,
  currentAcknowledged,
  saveState,
  failed,
  conflict,
}: {
  canPersist: boolean;
  ready: boolean;
  hasSavedVersions: boolean;
  currentAcknowledged: boolean;
  saveState: "saved" | "saving" | "unsaved" | "session_only";
  failed: boolean;
  conflict: boolean;
}) {
  if (!canPersist)
    return {
      label: "Session only",
      summary:
        "Versions are kept only while this Canvas is open. They are not saved to your account.",
    };
  const history = hasSavedVersions
    ? "Versions marked saved were confirmed by the server. Entries marked not saved remain in this open session."
    : "No saved versions have been confirmed. Versions shown here remain in this open session.";
  if (conflict || failed || !ready)
    return {
      label: "Not confirmed saved",
      summary: `${conflict ? "Resolve the version conflict before saving new edits." : failed ? "Saving is unavailable or failed." : "Saved history has not been confirmed."} The current draft is not confirmed saved. ${history}`,
    };
  if (saveState === "saving")
    return {
      label: "Saving…",
      summary: `Saving the current draft… It is not confirmed saved yet. ${history}`,
    };
  if (saveState === "saved" && currentAcknowledged)
    return {
      label: "Saved",
      summary: `Current content is confirmed saved to this Canvas. ${history}`,
    };
  return {
    label: saveState === "unsaved" ? "Unsaved" : "Not confirmed saved",
    summary: `The current draft is not confirmed saved. ${history}`,
  };
}
