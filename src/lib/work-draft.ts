import { createWorkSession } from "./work-session.mjs";
export type WorkPlanDraft = { objective: string; context: string; plan: string };
/** Rescue preserves the exact typed fields, including whitespace and incomplete input. */
export function serializeWorkDraft(draft: WorkPlanDraft) {
  return (
    JSON.stringify(
      {
        format: "kova-work-draft-v1",
        objective: draft.objective,
        context: draft.context,
        plan: draft.plan,
      },
      null,
      2,
    ) + "\n"
  );
}
/** Independent plan, never an execution or a claimed acknowledged branch. */
export function duplicateWorkDraft(draft: WorkPlanDraft) {
  return createWorkSession({
    objective: draft.objective,
    context: draft.context,
    plan: draft.plan
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  });
}
