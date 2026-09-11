export function parseWorkflowSkillMutationResult(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.ok !== true ||
    Object.keys(value).length !== 1
  ) {
    const error = new Error("Workflow skill update could not be confirmed. Try again.");
    error.name = "WorkflowSkillTransportError";
    throw error;
  }
  return { ok: true };
}
