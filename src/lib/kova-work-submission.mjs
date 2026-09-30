/** Validate a Kova Work request before the legacy provider admits or stores work. */
import { parseKovaWorkSelection } from "./kova-work-policy.mjs";
import { parseWorkSubmission } from "./work-execution-protocol.mjs";

export function hasKovaWorkSelection(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "kovaModel")
  );
}

export function kovaWorkSubmissionBoundary(input, tier) {
  if (!hasKovaWorkSelection(input)) throw new Error("work_kova_selection_invalid");
  const { kovaModel, ...legacyFields } = input;
  if (Object.hasOwn(input, "mode") || Object.hasOwn(input, "reasoningEffort"))
    throw new Error("work_kova_selection_invalid");

  // Retain the existing bounded objective, owner-independent UUID and request
  // field validation without persisting or dispatching a legacy provider job.
  parseWorkSubmission(legacyFields);
  try {
    parseKovaWorkSelection(kovaModel);
  } catch {
    throw new Error("work_kova_selection_invalid");
  }
  if (tier !== "plus" && tier !== "pro")
    return { error: "work_kova_entitlement_required", status: 403 };

  // No trusted active-model identity, receiving service or usage admission
  // exists for this app route. A legacy runner is never a Kova model.
  return { error: "work_kova_runtime_unverified", status: 503 };
}
