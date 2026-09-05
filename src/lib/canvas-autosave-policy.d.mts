export function canApplyLoadedArtifactHistory(
  loadRevision: number,
  currentRevision: number,
): boolean;

export function recoverFailedArtifactSnapshot(options: {
  failedSnapshot: string;
  scheduledSnapshot: string;
  durableSnapshot: string;
  generation: number;
  currentGeneration: number;
  effectCancelled: boolean;
}): { scheduledSnapshot: string; retryCurrentValue: boolean };
