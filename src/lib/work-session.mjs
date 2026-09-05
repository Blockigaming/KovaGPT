const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const text = (v, max) => typeof v === "string" && v.length <= max;
const stamp = (v) => Number.isSafeInteger(v) && v >= 0;
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const MAX_SESSION_EVENTS = 128;
export function validWorkSession(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    UUID.test(value.id ?? "") &&
    UUID.test(value.rootId ?? "") &&
    text(value.objective, 4000) &&
    value.objective.trim() &&
    text(value.context, 16000) &&
    stamp(value.createdAt) &&
    stamp(value.updatedAt) &&
    ["planning", "paused", "completed"].includes(value.status) &&
    Array.isArray(value.steps) &&
    value.steps.length <= 60 &&
    value.steps.every(
      (step) =>
        step &&
        UUID.test(step.id ?? "") &&
        text(step.text, 2000) &&
        step.text.trim() &&
        typeof step.done === "boolean",
    ) &&
    new Set(value.steps.map((step) => step.id)).size === value.steps.length &&
    (value.parent === null ||
      (value.parent &&
        UUID.test(value.parent.id ?? "") &&
        value.parent.id !== value.id &&
        Number.isSafeInteger(value.parent.revision) &&
        value.parent.revision > 0)) &&
    Array.isArray(value.events) &&
    value.events.length > 0 &&
    value.events.length <= MAX_SESSION_EVENTS &&
    value.events.every(
      (event) =>
        event &&
        UUID.test(event.id ?? "") &&
        stamp(event.at) &&
        [
          "created",
          "branched",
          "plan_updated",
          "step_updated",
          "status_updated",
          "conflict_resolved",
        ].includes(event.kind) &&
        text(event.label, 500) &&
        event.label.trim(),
    ) &&
    new Set(value.events.map((event) => event.id)).size === value.events.length,
  );
}
function checked(value) {
  if (!validWorkSession(value))
    throw new Error("The session could not be saved. Check the plan length and fields.");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 90 * 1024)
    throw new Error("This session is full. Start a branch to continue with a fresh history.");
  return value;
}
export function createWorkSession({ objective, context = "", plan = [] }, now = Date.now()) {
  const id = crypto.randomUUID();
  return checked({
    id,
    rootId: id,
    parent: null,
    objective: objective.trim(),
    context,
    steps: plan.map((text) => ({ id: crypto.randomUUID(), text, done: false })),
    status: "planning",
    createdAt: now,
    updatedAt: now,
    events: [
      { id: crypto.randomUUID(), at: now, kind: "created", label: "Planning session created" },
    ],
  });
}
export function updateWorkSession(session, changes, kind, label, now = Date.now()) {
  if (session.events.length >= MAX_SESSION_EVENTS)
    throw new Error("This session history is full. Sync it, then start a branch to continue.");
  const { objective, context, steps, status } = { ...session, ...changes };
  return checked({
    ...session,
    objective,
    context,
    steps,
    status,
    updatedAt: now,
    events: [
      ...session.events,
      { id: crypto.randomUUID(), at: now, kind, label: label.slice(0, 500) },
    ],
  });
}
export function branchWorkSession(session, revision, now = Date.now()) {
  return checked({
    ...session,
    id: crypto.randomUUID(),
    parent: { id: session.id, revision },
    status: "planning",
    createdAt: now,
    updatedAt: now,
    events: [
      {
        id: crypto.randomUUID(),
        at: now,
        kind: "branched",
        label: "Branched from a saved planning session",
      },
    ],
  });
}
/** A conflict choice may change the plan, but cannot erase acknowledged history. */
export function mergeWorkSessionHistory(account, device) {
  if (
    !validWorkSession(account) ||
    !validWorkSession(device) ||
    account.id !== device.id ||
    account.rootId !== device.rootId ||
    canonical(account.parent) !== canonical(device.parent)
  )
    throw new Error("Session history changed. Keep the account copy and create a branch.");
  const events = new Map(account.events.map((event) => [event.id, event]));
  for (const event of device.events) {
    if (events.has(event.id) && canonical(events.get(event.id)) !== canonical(event))
      throw new Error("Session history changed. Keep the account copy and create a branch.");
    events.set(event.id, event);
  }
  return updateWorkSession(
    { ...device, events: [...events.values()] },
    {},
    "conflict_resolved",
    "Device plan retained after comparing account changes",
  );
}
