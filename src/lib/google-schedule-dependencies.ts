// This is a deliberately partial view: the existing grant reader excludes
// revoked/expired grants and has no project dependency inventory.
export const GOOGLE_DEPENDENCY_DISPLAY_LIMIT = 20;
export type KnownGoogleSchedule = { id: string; title: string; href: string };
export type GoogleScheduleDependencies = { schedules: KnownGoogleSchedule[]; knownCount: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providers = new Set(["gmail", "slack", "github"]);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Schedule dependencies are unavailable.");
  return value as Record<string, unknown>;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error("Schedule dependencies are unavailable.");
  return value;
}

export function findKnownGoogleScheduleDependencies(
  connectionId: string,
  tasks: unknown,
  grants: unknown,
  now = Date.now(),
): GoogleScheduleDependencies {
  identity(connectionId);
  // Match the existing readers' bounds; an invalid/oversized response is never
  // converted into an empty dependency list.
  if (
    !Array.isArray(tasks) ||
    tasks.length > 5000 ||
    !Array.isArray(grants) ||
    grants.length > 20 ||
    !Number.isFinite(now)
  )
    throw new Error("Schedule dependencies are unavailable.");

  const matchingGrants = new Set<string>();
  const seenGrants = new Set<string>();
  for (const value of grants) {
    const grant = record(value);
    const id = identity(grant.id);
    const connection = identity(grant.connection_ref);
    const expiresAt = typeof grant.expires_at === "string" ? Date.parse(grant.expires_at) : NaN;
    if (seenGrants.has(id) || !providers.has(String(grant.provider)) || !Number.isFinite(expiresAt))
      throw new Error("Schedule dependencies are unavailable.");
    seenGrants.add(id);
    // GoogleStatus.accounts[].id and Gmail grant.connection_ref are both the
    // actual google_oauth_tokens row id. Other provider IDs are not equivalent.
    if (grant.provider === "gmail" && connection === connectionId && expiresAt > now)
      matchingGrants.add(id);
  }

  const schedules: KnownGoogleSchedule[] = [];
  let knownCount = 0;
  const seenTasks = new Set<string>();
  for (const value of tasks) {
    const task = record(value);
    const id = identity(task.id);
    if (
      seenTasks.has(id) ||
      typeof task.title !== "string" ||
      task.title.length > 2000 ||
      !Array.isArray(task.context_refs) ||
      task.context_refs.length > 8 ||
      !Array.isArray(task.event_triggers) ||
      task.event_triggers.length > 3
    )
      throw new Error("Schedule dependencies are unavailable.");
    seenTasks.add(id);
    let matches = false;
    for (const value of task.context_refs) {
      const ref = record(value);
      if (ref.kind === "connected") {
        const grantId = identity(ref.grantId);
        if (!providers.has(String(ref.provider)))
          throw new Error("Schedule dependencies are unavailable.");
        matches ||= ref.provider === "gmail" && matchingGrants.has(grantId);
      } else if (!["snapshot", "library", "project_file"].includes(String(ref.kind))) {
        throw new Error("Schedule dependencies are unavailable.");
      }
    }
    for (const value of task.event_triggers) {
      const trigger = record(value);
      const grantId = identity(trigger.grantId);
      if (!providers.has(String(trigger.provider)))
        throw new Error("Schedule dependencies are unavailable.");
      matches ||= trigger.provider === "gmail" && matchingGrants.has(grantId);
    }
    if (!matches) continue;
    knownCount += 1;
    if (schedules.length < GOOGLE_DEPENDENCY_DISPLAY_LIMIT)
      schedules.push({
        id,
        title: task.title.trim() || "Untitled schedule",
        href: `/scheduled-tasks?taskId=${encodeURIComponent(id)}`,
      });
  }
  return { schedules, knownCount };
}
