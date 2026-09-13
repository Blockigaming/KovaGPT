export const MAX_PENDING_WORKFLOW_SKILL_MUTATIONS = 32;

/**
 * @template T
 * @param {Map<string, T>} envelopes
 * @param {string} retryKey
 * @param {() => T} createEnvelope
 * @returns {T | null}
 */
export function reserveWorkflowSkillMutationEnvelope(envelopes, retryKey, createEnvelope) {
  const existing = envelopes.get(retryKey);
  if (existing) return existing;
  if (envelopes.size >= MAX_PENDING_WORKFLOW_SKILL_MUTATIONS) return null;
  const envelope = createEnvelope();
  envelopes.set(retryKey, envelope);
  return envelope;
}
