/** Inspector categories come only from exact structured event types and task IDs. */
export const WORK_INSPECTOR_CATEGORIES = [
  "objective",
  "inputs",
  "outputs",
  "browser",
  "tool",
  "provider",
  "log",
  "memory",
  "handoff",
  "deliverable",
  "screenshot",
  "approval",
  "evidence",
  "other",
];
const exactTypes = new Map(
  WORK_INSPECTOR_CATEGORIES.filter((kind) => kind !== "other").flatMap((kind) => [
    [kind, kind],
    [`${kind}_event`, kind],
  ]),
);
export function classifySpecialistEvents(events, taskId) {
  const groups = Object.fromEntries(WORK_INSPECTOR_CATEGORIES.map((kind) => [kind, []]));
  if (typeof taskId !== "string" || !taskId) return groups;
  for (const event of events) {
    if (!event || typeof event !== "object" || event.payload?.specialist_task_id !== taskId)
      continue;
    const kind = exactTypes.get(event.type) ?? "other";
    groups[kind].push(event);
  }
  return groups;
}
