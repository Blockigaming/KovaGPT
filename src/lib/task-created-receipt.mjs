// Only the identity returned by a persisted creation can establish success.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function normalizeTaskCreatedReceipt(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.operation !== "created" ||
    value.source !== "persisted-result" ||
    typeof value.taskId !== "string" ||
    !UUID.test(value.taskId)
  )
    return null;
  return { operation: "created", source: "persisted-result", taskId: value.taskId };
}
export function taskCreatedReceiptFromResult(task) {
  return normalizeTaskCreatedReceipt({
    operation: "created",
    source: "persisted-result",
    taskId: task?.id,
  });
}
export function normalizeTaskCreationFailureReceipt(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.operation !== "not-created" ||
    value.source !== "confirmed-result" ||
    typeof value.reason !== "string" ||
    !value.reason.trim()
  )
    return null;
  return {
    operation: "not-created",
    source: "confirmed-result",
    reason: value.reason.trim().slice(0, 500),
  };
}
export function taskCreationNotice(activity) {
  if (activity?.tool !== "scheduled_task") return null;
  const receipt = activity.status === "done" && normalizeTaskCreatedReceipt(activity.taskReceipt);
  if (receipt) return { success: true, text: "Scheduled task created", taskId: receipt.taskId };
  if (activity.status === "running") return { success: false, text: "Creating scheduled task…" };
  const failure =
    activity.status === "failed" && normalizeTaskCreationFailureReceipt(activity.taskFailure);
  if (failure)
    return { success: false, text: "Scheduled task not created", reason: failure.reason };
  // A failed transport or readback may follow a committed create. Never invite
  // another creation until the existing operation has been checked.
  return {
    success: false,
    text: "Scheduled task status unconfirmed",
    reason: "Open Scheduled tasks to check whether it was created before trying again.",
  };
}
