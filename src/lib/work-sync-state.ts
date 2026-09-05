import { validWorkSession, mergeWorkSessionHistory, createWorkSession } from "./work-session.mjs";
import { parseWorkSyncMutation, type WorkSyncMutation } from "./work-sync-policy.mjs";

export type SavedWorkKind = "task" | "template" | "agent_draft" | "session";
export type RecentWorkKind = SavedWorkKind | "run";
export type WorkPayload = Record<string, unknown> & { id: string };
export type SavedWorkRecord = {
  id: string;
  kind: SavedWorkKind;
  title: string;
  payload: WorkPayload;
  revision: number;
  syncVersion: number;
  deletedAt: string | null;
};
export type RecentWorkRecord = {
  resourceId: string;
  resourceType: RecentWorkKind;
  revision: number;
  syncVersion: number;
  deletedAt: string | null;
  pinnedAt: string | null;
  lastOpenedAt: string;
};
export type WorkSyncPending = {
  id: string;
  kind: RecentWorkKind;
  desired: WorkPayload | null | "keep" | "pin" | "unpin" | "forget";
  expectedRevision: number;
  request?: WorkSyncMutation;
  conflict?: boolean;
};
export type WorkSyncState = {
  version: 1;
  ownerId: string;
  cursor: number;
  records: Record<string, SavedWorkRecord>;
  recents: Record<string, RecentWorkRecord>;
  pending: Record<string, WorkSyncPending>;
  lastSyncedAt: number | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = new Set(["task", "template", "agent_draft", "session"]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const timestamp = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const nullableDate = (value: unknown) =>
  value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, entry: unknown) =>
    isObject(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const clone = (state: WorkSyncState) => structuredClone(state);
export const WORK_STORE_CHANGED_EVENT = "kova:work-store-changed";
let writableOwner: string | null = null;
export function setWorkSyncWritableOwner(ownerId: string | null, previousOwner?: string) {
  if (previousOwner !== undefined && writableOwner !== previousOwner) return;
  writableOwner = ownerId;
}
export function assertWorkSyncWritable(ownerId: string) {
  if (writableOwner !== ownerId)
    throw new Error(
      "Saved work is open in another tab or is still connecting. Retry here after closing the other tab.",
    );
}

export function workSyncStorageKey(ownerId: string) {
  if (typeof ownerId !== "string" || !ownerId || ownerId.length > 512)
    throw new Error("work_sync_principal_invalid");
  return `kova-work-sync-v1:user:${encodeURIComponent(ownerId)}`;
}

/** Validate the actual local view contract before letting remote JSON enter existing components. */
export function validWorkPayload(kind: SavedWorkKind, value: unknown): value is WorkPayload {
  if (kind === "session") return validWorkSession(value);
  if (!isObject(value) || typeof value.id !== "string" || !UUID.test(value.id)) return false;
  if (!timestamp(value.updatedAt) || typeof value.objective !== "string") return false;
  if (kind === "template")
    return (
      typeof value.name === "string" && typeof value.context === "string" && strings(value.plan)
    );
  if (!timestamp(value.createdAt)) return false;
  if (kind === "task") {
    return (
      typeof value.context === "string" &&
      (value.project === undefined || typeof value.project === "string") &&
      ["planning", "paused", "completed", "cancelled"].includes(String(value.status)) &&
      strings(value.deliverables) &&
      Array.isArray(value.steps) &&
      value.steps.every(
        (step) =>
          isObject(step) &&
          typeof step.id === "string" &&
          typeof step.text === "string" &&
          typeof step.done === "boolean" &&
          typeof step.approval === "boolean" &&
          typeof step.approved === "boolean",
      )
    );
  }
  return (
    typeof value.name === "string" &&
    typeof value.instructions === "string" &&
    typeof value.project === "string" &&
    strings(value.context) &&
    strings(value.steps) &&
    Array.isArray(value.tools) &&
    value.tools.every((tool) => ["web", "files", "apps"].includes(tool)) &&
    Array.isArray(value.approvalSteps) &&
    value.approvalSteps.every((step) => Number.isSafeInteger(step) && Number(step) >= 0) &&
    ["draft", "ready", "handed_off", "approval_needed", "paused", "failed", "completed"].includes(
      String(value.status),
    ) &&
    Array.isArray(value.log) &&
    value.log.every(
      (entry) => isObject(entry) && timestamp(entry.at) && typeof entry.message === "string",
    )
  );
}

export function visibleWorkRecords(state: WorkSyncState, kind: SavedWorkKind): WorkPayload[] {
  const values = new Map<string, WorkPayload>();
  for (const record of Object.values(state.records)) {
    if (record.kind === kind && !record.deletedAt) values.set(record.id, record.payload);
  }
  for (const [key, pending] of Object.entries(state.pending)) {
    if (key.startsWith("recent:") || pending.kind !== kind) continue;
    if (pending.desired === null) values.delete(pending.id);
    else if (typeof pending.desired === "object") values.set(pending.id, pending.desired);
  }
  return [...values.values()].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

export function replaceLocalWork(
  state: WorkSyncState,
  kind: SavedWorkKind,
  values: unknown[],
): WorkSyncState {
  const next = clone(state);
  if (values.length > 500 || !values.every((value) => validWorkPayload(kind, value)))
    throw new Error("work_sync_local_data_invalid");
  const wanted = new Map(values.map((value) => [value.id, value]));
  if (wanted.size !== values.length) throw new Error("work_sync_local_data_invalid");
  const previous = new Map(visibleWorkRecords(state, kind).map((value) => [value.id, value]));
  for (const id of new Set([...wanted.keys(), ...previous.keys()])) {
    const desired = wanted.get(id) ?? null;
    if (same(desired, previous.get(id) ?? null)) continue;
    const record = next.records[id];
    if (record && record.kind !== kind) throw new Error("work_sync_record_kind_conflict");
    const pending = next.pending[id];
    if (pending && pending.kind !== kind) throw new Error("work_sync_record_kind_conflict");
    if (desired === null && !record && pending && !pending.request) {
      delete next.pending[id];
      continue;
    }
    // A sent request is immutable until its receipt settles, including after reload/offline retry.
    next.pending[id] = pending
      ? { ...pending, desired }
      : { id, kind, desired, expectedRevision: record?.revision ?? 0 };
  }
  next.lastSyncedAt = null;
  return next;
}

export function createWorkSyncState(
  ownerId: string,
  initial: Partial<Record<SavedWorkKind, unknown[]>>,
): WorkSyncState {
  if (!UUID.test(ownerId)) throw new Error("work_sync_principal_invalid");
  workSyncStorageKey(ownerId);
  let state: WorkSyncState = {
    version: 1,
    ownerId,
    cursor: 0,
    records: {},
    recents: {},
    pending: {},
    lastSyncedAt: null,
  };
  for (const kind of ["task", "template", "agent_draft", "session"] as const)
    state = replaceLocalWork(state, kind, initial[kind] ?? []);
  return state;
}

export function readWorkSyncState(
  storage: Pick<Storage, "getItem">,
  ownerId: string,
): WorkSyncState | null {
  const raw = storage.getItem(workSyncStorageKey(ownerId));
  if (raw === null) return null;
  const state: unknown = JSON.parse(raw);
  if (
    !isObject(state) ||
    state.version !== 1 ||
    state.ownerId !== ownerId ||
    !Number.isSafeInteger(state.cursor) ||
    Number(state.cursor) < 0 ||
    !isObject(state.records) ||
    !isObject(state.recents) ||
    !isObject(state.pending)
  )
    throw new Error("work_sync_local_state_invalid");
  return state as WorkSyncState;
}

export function writeWorkSyncState(storage: Pick<Storage, "setItem">, state: WorkSyncState) {
  // One atomic localStorage entry contains both data and cursor; never advance one without the other.
  storage.setItem(workSyncStorageKey(state.ownerId), JSON.stringify(state));
}

export function applyWorkSyncPage(state: WorkSyncState, value: unknown): WorkSyncState {
  if (
    !isObject(value) ||
    !Array.isArray(value.savedRecords) ||
    !Array.isArray(value.recentItems) ||
    !Number.isSafeInteger(value.nextCursor) ||
    Number(value.nextCursor) < state.cursor ||
    !Number.isSafeInteger(value.currentVersion) ||
    Number(value.currentVersion) < Number(value.nextCursor) ||
    typeof value.hasMore !== "boolean" ||
    (value.hasMore && Number(value.nextCursor) <= state.cursor) ||
    value.savedRecords.length + value.recentItems.length > 500
  )
    throw new Error("work_sync_response_invalid");
  const next = clone(state);
  const versions = new Set<number>();
  for (const raw of value.savedRecords) {
    if (
      !isObject(raw) ||
      typeof raw.id !== "string" ||
      !UUID.test(raw.id) ||
      !KINDS.has(String(raw.kind)) ||
      typeof raw.title !== "string" ||
      !positive(raw.revision) ||
      !positive(raw.syncVersion) ||
      !nullableDate(raw.deletedAt) ||
      (!raw.deletedAt &&
        (!validWorkPayload(raw.kind as SavedWorkKind, raw.payload) || raw.payload.id !== raw.id))
    )
      throw new Error("work_sync_record_invalid");
    const record = raw as SavedWorkRecord;
    if (
      record.syncVersion <= state.cursor ||
      record.syncVersion > Number(value.nextCursor) ||
      versions.has(record.syncVersion)
    )
      throw new Error("work_sync_cursor_invalid");
    versions.add(record.syncVersion);
    if (!next.records[record.id] || record.syncVersion > next.records[record.id].syncVersion)
      next.records[record.id] = record;
    const pending = next.pending[record.id];
    if (pending && !pending.request && record.revision !== pending.expectedRevision) {
      if (same(pending.desired, record.deletedAt ? null : record.payload))
        delete next.pending[record.id];
      else pending.conflict = true;
    }
  }
  for (const raw of value.recentItems) {
    if (
      !isObject(raw) ||
      typeof raw.resourceId !== "string" ||
      !UUID.test(raw.resourceId) ||
      !["run", "task", "template", "agent_draft"].includes(String(raw.resourceType)) ||
      !positive(raw.revision) ||
      !positive(raw.syncVersion) ||
      !nullableDate(raw.deletedAt) ||
      !nullableDate(raw.pinnedAt) ||
      typeof raw.lastOpenedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.lastOpenedAt))
    )
      throw new Error("work_sync_recent_invalid");
    const record = raw as RecentWorkRecord;
    if (
      record.syncVersion <= state.cursor ||
      record.syncVersion > Number(value.nextCursor) ||
      versions.has(record.syncVersion)
    )
      throw new Error("work_sync_cursor_invalid");
    versions.add(record.syncVersion);
    const key = `recent:${record.resourceType}:${record.resourceId}`;
    if (!next.recents[key] || record.syncVersion > next.recents[key].syncVersion)
      next.recents[key] = record;
    const pending = next.pending[key];
    if (pending && !pending.request && pending.expectedRevision !== record.revision)
      pending.conflict = true;
  }
  if (
    (versions.size === 0 && Number(value.nextCursor) !== state.cursor) ||
    (versions.size > 0 && Math.max(...versions) !== Number(value.nextCursor)) ||
    value.hasMore !== Number(value.currentVersion) > Number(value.nextCursor)
  )
    throw new Error("work_sync_cursor_invalid");
  next.cursor = Number(value.nextCursor);
  return next;
}

export function queueWorkRecent(
  state: WorkSyncState,
  kind: RecentWorkKind,
  id: string,
  desired: "keep" | "pin" | "unpin" | "forget",
) {
  if (!UUID.test(id)) throw new Error("work_sync_record_id_invalid");
  const next = clone(state),
    key = `recent:${kind}:${id}`;
  next.pending[key] = next.pending[key]
    ? { ...next.pending[key], desired }
    : { id, kind, desired, expectedRevision: next.recents[key]?.revision ?? 0 };
  next.lastSyncedAt = null;
  return next;
}

export function prepareWorkMutation(state: WorkSyncState, key: string, mutationId: string) {
  const next = clone(state),
    pending = next.pending[key];
  if (!pending || pending.conflict) throw new Error("work_sync_conflict");
  if (!pending.request) {
    if (typeof pending.desired === "string") {
      pending.request = parseWorkSyncMutation({
        action: "recent",
        mutationId,
        resourceType: pending.kind,
        resourceId: pending.id,
        pin: pending.desired,
        expectedRevision: pending.expectedRevision,
      });
    } else if (pending.desired === null) {
      pending.request = parseWorkSyncMutation({
        action: "delete",
        mutationId,
        id: pending.id,
        expectedRevision: pending.expectedRevision,
      });
    } else {
      const title = String(pending.desired.name ?? pending.desired.objective)
        .trim()
        .replace(/\s+/gu, " ")
        .slice(0, 160);
      pending.request = parseWorkSyncMutation({
        action: "save",
        mutationId,
        id: pending.id,
        kind: pending.kind,
        title,
        payload: pending.desired,
        expectedRevision: pending.expectedRevision,
      });
    }
  }
  return next;
}

export function settleWorkMutation(
  state: WorkSyncState,
  key: string,
  mutationId: string,
  value: unknown,
) {
  const next = clone(state),
    pending = next.pending[key],
    request = pending?.request;
  if (!request || request.mutationId !== mutationId) throw new Error("work_sync_receipt_mismatch");
  if (!isObject(value) || !isObject(value.result)) throw new Error("work_sync_response_invalid");
  const result = value.result;
  if (
    !positive(result.revision) ||
    !positive(result.syncVersion) ||
    !nullableDate(result.deletedAt)
  )
    throw new Error("work_sync_response_invalid");
  if (
    Number(result.revision) < request.expectedRevision! ||
    (request.action === "save" && result.deletedAt !== null) ||
    (request.action === "delete" && result.deletedAt === null)
  )
    throw new Error("work_sync_receipt_mismatch");
  if (request.action === "recent") {
    if (
      result.resourceId !== request.resourceId ||
      result.resourceType !== request.resourceType ||
      !nullableDate(result.pinnedAt) ||
      typeof result.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(result.updatedAt)) ||
      (request.pin === "forget" ? result.deletedAt === null : result.deletedAt !== null)
    )
      throw new Error("work_sync_receipt_mismatch");
    // The RPC sets last_opened_at and updated_at to the same transaction timestamp.
    if (!next.recents[key] || Number(result.syncVersion) >= next.recents[key].syncVersion)
      next.recents[key] = { ...result, lastOpenedAt: result.updatedAt } as RecentWorkRecord;
  } else {
    if (result.id !== request.id) throw new Error("work_sync_receipt_mismatch");
    if (
      !next.records[request.id] ||
      Number(result.syncVersion) >= next.records[request.id].syncVersion
    ) {
      next.records[request.id] = {
        id: request.id,
        kind: pending.kind as SavedWorkKind,
        title: request.action === "save" ? request.title : "",
        payload: request.action === "save" ? (request.payload as WorkPayload) : { id: request.id },
        revision: Number(result.revision),
        syncVersion: Number(result.syncVersion),
        deletedAt: result.deletedAt as string | null,
      };
    }
  }
  const sent =
    request.action === "save" ? request.payload : request.action === "delete" ? null : request.pin;
  if (same(sent, pending.desired)) delete next.pending[key];
  else
    next.pending[key] = {
      id: pending.id,
      kind: pending.kind,
      desired: pending.desired,
      expectedRevision: Number(result.revision),
    };
  return next;
}

export function resolveWorkConflict(
  state: WorkSyncState,
  key: string,
  choice: "account" | "device" | "new_session",
) {
  const next = clone(state),
    pending = next.pending[key];
  if (!pending?.conflict) throw new Error("work_sync_conflict_missing");
  if (choice === "new_session") {
    if (pending.kind !== "session" || !validWorkSession(pending.desired))
      throw new Error("work_sync_conflict_missing");
    const source = pending.desired;
    const recovered = createWorkSession({ objective: source.objective, context: source.context });
    recovered.steps = source.steps;
    recovered.status = source.status;
    recovered.events[0].label = "Current plan recovered as a new independent session";
    delete next.pending[key];
    next.pending[recovered.id] = {
      id: recovered.id,
      kind: "session",
      desired: recovered,
      expectedRevision: 0,
    };
    next.lastSyncedAt = null;
    return next;
  }
  if (choice === "account") delete next.pending[key];
  else
    next.pending[key] = {
      id: pending.id,
      kind: pending.kind,
      desired:
        pending.kind === "session" &&
        typeof pending.desired === "object" &&
        pending.desired &&
        next.records[key] &&
        !next.records[key].deletedAt
          ? mergeWorkSessionHistory(
              next.records[key].payload as import("./work-session.mjs").WorkSession,
              pending.desired as import("./work-session.mjs").WorkSession,
            )
          : pending.desired,
      expectedRevision:
        (key.startsWith("recent:") ? next.recents[key]?.revision : next.records[key]?.revision) ??
        0,
    };
  next.lastSyncedAt = null;
  return next;
}

/** Dependency-injected single turn for executable offline/retry/account-switch tests. */
export async function synchronizeWorkTurn(io: {
  load: () => WorkSyncState;
  save: (state: WorkSyncState) => void;
  request: (path: string, body?: unknown) => Promise<unknown>;
  alive: () => boolean;
  pull: boolean;
  mutationId: () => string;
}) {
  const guard = () => {
    if (!io.alive()) throw new Error("work_sync_identity_changed");
  };
  if (io.pull) {
    for (let page = 0; page < 110; page++) {
      guard();
      const before = io.load();
      const value = await io.request(`/api/work/sync?cursor=${before.cursor}&limit=40`);
      guard();
      const latest = io.load();
      // Only the lease holder can write this principal's envelope, so the cursor must remain stable.
      if (latest.cursor !== before.cursor) throw new Error("work_sync_cursor_changed");
      io.save(applyWorkSyncPage(latest, value));
      if (!(value as { hasMore: boolean }).hasMore) break;
      if (page === 109) throw new Error("work_sync_page_limit");
    }
  }
  guard();
  const state = io.load();
  const key = Object.keys(state.pending).find((candidate) => !state.pending[candidate].conflict);
  if (!key) {
    io.save({ ...state, lastSyncedAt: Object.keys(state.pending).length ? null : Date.now() });
    return;
  }
  const prepared = prepareWorkMutation(state, key, io.mutationId());
  io.save(prepared); // Durable immutable mutationId/body before sending, including offline retries.
  const request = prepared.pending[key].request!;
  try {
    const value = await io.request("/api/work/sync", request);
    guard();
    io.save(settleWorkMutation(io.load(), key, request.mutationId, value));
  } catch (error) {
    guard();
    if (error instanceof Error && error.message === "work_sync_conflict") {
      const latest = io.load();
      if (latest.pending[key]?.request?.mutationId === request.mutationId) {
        latest.pending[key].conflict = true;
        io.save(latest);
      }
    }
    throw error;
  }
}
