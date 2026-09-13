export const MAX_PENDING_WORKFLOW_SKILL_MUTATIONS: 32;

export function reserveWorkflowSkillMutationEnvelope<T>(
  envelopes: Map<string, T>,
  retryKey: string,
  createEnvelope: () => T,
): T | null;
