import { activityHostname } from "./activity-display.mjs";
// This is a public status projection, never the model's private reasoning,
// command input, page contents, or approval payload.
export function publicWorkActivity(run, kind, detail = {}) {
  const labels = {
    admitted: "Work queued",
    claimed: "Agent started work",
    step_started: "Working on the next step…",
    step_completed: "Agent step completed",
    approval_requested: "Waiting for your approval",
    action_approved: "Action approved",
    effect_started: "Carrying out the approved action…",
    effect_settled: "Action result checked",
    question_requested: "Waiting for your answer",
    question_answered: "Answer received",
    paused: "Work paused",
    resumed: "Work resumed",
    completed: "Work completed",
    failed: "Work failed",
    cancelled: "Work canceled",
    specialists_delegated: "Specialist tasks prepared",
    specialist_started: "Specialist started work",
    specialist_completed: "Specialist finished its step",
  };
  if (!labels[kind]) return undefined;
  let input;
  if (run.approval?.action === "browser_interact") {
    try {
      input = JSON.parse(run.approval.canonicalInput);
    } catch {
      /* no public site */
    }
  }
  const hostname = activityHostname(input?.url ?? run.effect?.result?.url);
  const browser =
    !!input &&
    (kind === "effect_started" || (kind === "step_completed" && detail.browserAction === true));
  const failed = kind === "failed" || run.status === "failed" || run.effect?.status === "failed";
  const running = kind === "step_started" || kind === "effect_started";
  return {
    activityId:
      browser && run.effect?.id
        ? `effect-${run.effect.id}`
        : `work-${kind.startsWith("step_") ? (run.step?.id ?? run.stepIds?.at(-1) ?? run.revision) : run.revision}`,
    tool: browser ? "browser_interact" : "agent",
    label:
      browser && hostname
        ? `${running ? (["open", "navigate"].includes(input?.operation) ? "Opening" : "Working on") : failed ? "Could not open" : "Browser step on"} ${hostname}${running ? "…" : ""}`
        : failed && kind === "step_completed"
          ? "Agent step failed"
          : labels[kind],
    ...(hostname && browser ? { hostname } : {}),
    status: failed ? "failed" : kind === "cancelled" ? "canceled" : running ? "running" : "done",
  };
}
