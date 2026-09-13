import type { WorkSession } from "./work-session.mjs";
import {
  assertWorkSyncWritable,
  readWorkSyncState,
  replaceLocalWork,
  visibleWorkRecords,
  writeWorkSyncState,
  WORK_STORE_CHANGED_EVENT,
  type SavedWorkKind,
} from "./work-sync-state.ts";

export type WorkStatus = "planning" | "paused" | "completed" | "cancelled";
export type WorkStep = {
  id: string;
  text: string;
  done: boolean;
  approval: boolean;
  approved: boolean;
};
export type WorkTask = {
  id: string;
  objective: string;
  project?: string;
  context: string;
  steps: WorkStep[];
  deliverables: string[];
  status: WorkStatus;
  createdAt: number;
  updatedAt: number;
};
/** Pass null only after authentication has resolved to a confirmed guest. */
export type WorkStorageUserKey = string | null;

const WORK_SESSIONS_KEY_BASE = "kova-work-sessions-v1";
const WORK_TASKS_KEY_BASE = "kova-work-tasks-v2";
const WORK_TEMPLATES_KEY_BASE = "kova-work-templates-v2";
const AGENT_WORKSPACE_KEY_BASE = "kova-agent-workspace-v2";

const LEGACY_WORK_TASKS_KEY = "kova-work-tasks-v1";
const LEGACY_WORK_TEMPLATES_KEY = "kova-work-templates-v1";
const LEGACY_AGENT_WORKSPACE_KEY = "kova-agent-workspace-v1";
export type WorkTemplate = {
  id: string;
  name: string;
  objective: string;
  context: string;
  plan: string[];
  updatedAt: number;
};
export type AgentRunStatus =
  "draft" | "ready" | "handed_off" | "approval_needed" | "paused" | "failed" | "completed";
export type AgentRun = {
  id: string;
  name: string;
  objective: string;
  instructions: string;
  project: string;
  context: string[];
  tools: ("web" | "files" | "apps")[];
  steps: string[];
  approvalSteps: number[];
  status: AgentRunStatus;
  log: { at: number; message: string }[];
  createdAt: number;
  updatedAt: number;
};

/** A stable browser-storage namespace. Signed-in and guest work never share one key. */
export function workStoragePrincipal(userKey: WorkStorageUserKey): string {
  return userKey === null ? "guest" : `user:${encodeURIComponent(userKey)}`;
}

function scopedKey(base: string, userKey: WorkStorageUserKey): string {
  return `${base}:${workStoragePrincipal(userKey)}`;
}

export function workTasksStorageKey(userKey: WorkStorageUserKey): string {
  return scopedKey(WORK_TASKS_KEY_BASE, userKey);
}

export function workTemplatesStorageKey(userKey: WorkStorageUserKey): string {
  return scopedKey(WORK_TEMPLATES_KEY_BASE, userKey);
}

export function agentWorkspaceStorageKey(userKey: WorkStorageUserKey): string {
  return scopedKey(AGENT_WORKSPACE_KEY_BASE, userKey);
}

function parseArray<T>(raw: string): T[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function loadPrincipalArray<T>(userKey: WorkStorageUserKey, key: string, legacyKey: string): T[] {
  if (userKey !== null) {
    const synced = readWorkSyncState(localStorage, userKey);
    if (synced) return visibleWorkRecords(synced, kindForKey(key)) as T[];
  }
  const currentRaw = localStorage.getItem(key);
  if (currentRaw !== null || userKey !== null) {
    return currentRaw === null ? [] : (parseArray<T>(currentRaw) ?? []);
  }

  const legacyRaw = localStorage.getItem(legacyKey);
  if (legacyRaw === null) return [];
  const legacy = parseArray<T>(legacyRaw);
  if (legacy === null) return [];

  try {
    localStorage.setItem(key, legacyRaw);
    localStorage.removeItem(legacyKey);
  } catch {
    // Preserve the readable legacy guest value when storage is unavailable.
  }
  return legacy;
}

function savePrincipalArray<T>(
  userKey: WorkStorageUserKey,
  key: string,
  legacyKey: string,
  values: T[],
): void {
  if (userKey !== null) {
    const synced = readWorkSyncState(localStorage, userKey);
    if (synced) {
      assertWorkSyncWritable(userKey);
      writeWorkSyncState(localStorage, replaceLocalWork(synced, kindForKey(key), values));
      window.dispatchEvent(
        new CustomEvent(WORK_STORE_CHANGED_EVENT, { detail: { ownerId: userKey } }),
      );
      return;
    }
  }
  localStorage.setItem(key, JSON.stringify(values));
  window.dispatchEvent(new CustomEvent(WORK_STORE_CHANGED_EVENT, { detail: { ownerId: userKey } }));
  if (userKey === null) {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // The scoped guest value was saved; legacy cleanup remains best effort.
    }
  }
}

function kindForKey(key: string): SavedWorkKind {
  if (key.startsWith(WORK_SESSIONS_KEY_BASE)) return "session";
  return key.startsWith(WORK_TASKS_KEY_BASE)
    ? "task"
    : key.startsWith(WORK_TEMPLATES_KEY_BASE)
      ? "template"
      : "agent_draft";
}

export function loadWorkTasks(userKey: WorkStorageUserKey): WorkTask[] {
  if (typeof window === "undefined") return [];
  try {
    return loadPrincipalArray<WorkTask>(
      userKey,
      workTasksStorageKey(userKey),
      LEGACY_WORK_TASKS_KEY,
    );
  } catch {
    return [];
  }
}
export function saveWorkTasks(userKey: WorkStorageUserKey, tasks: WorkTask[]) {
  if (typeof window !== "undefined") {
    savePrincipalArray(userKey, workTasksStorageKey(userKey), LEGACY_WORK_TASKS_KEY, tasks);
  }
}
export function createWorkTask(
  objective: string,
  project: string,
  context: string,
  plan: string[],
): WorkTask {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    objective,
    project: project || undefined,
    context,
    steps: plan.filter(Boolean).map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
      approval: false,
      approved: false,
    })),
    deliverables: [],
    status: "planning",
    createdAt: now,
    updatedAt: now,
  };
}
export function loadWorkTemplates(userKey: WorkStorageUserKey): WorkTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    return loadPrincipalArray<WorkTemplate>(
      userKey,
      workTemplatesStorageKey(userKey),
      LEGACY_WORK_TEMPLATES_KEY,
    );
  } catch {
    return [];
  }
}
export function saveWorkTemplates(userKey: WorkStorageUserKey, templates: WorkTemplate[]) {
  if (typeof window !== "undefined") {
    savePrincipalArray(
      userKey,
      workTemplatesStorageKey(userKey),
      LEGACY_WORK_TEMPLATES_KEY,
      templates,
    );
  }
}
export function loadAgentRuns(userKey: WorkStorageUserKey): AgentRun[] {
  if (typeof window === "undefined") return [];
  try {
    return loadPrincipalArray<AgentRun>(
      userKey,
      agentWorkspaceStorageKey(userKey),
      LEGACY_AGENT_WORKSPACE_KEY,
    );
  } catch {
    return [];
  }
}
export function saveAgentRuns(userKey: WorkStorageUserKey, runs: AgentRun[]) {
  if (typeof window !== "undefined") {
    savePrincipalArray(
      userKey,
      agentWorkspaceStorageKey(userKey),
      LEGACY_AGENT_WORKSPACE_KEY,
      runs,
    );
  }
}

export function workSessionsStorageKey(userKey: WorkStorageUserKey): string {
  return scopedKey(WORK_SESSIONS_KEY_BASE, userKey);
}
export function loadWorkSessions(userKey: WorkStorageUserKey): WorkSession[] {
  if (typeof window === "undefined") return [];
  try {
    return loadPrincipalArray<WorkSession>(
      userKey,
      workSessionsStorageKey(userKey),
      "kova-work-sessions-none",
    );
  } catch {
    return [];
  }
}
export function saveWorkSessions(userKey: WorkStorageUserKey, values: WorkSession[]) {
  if (typeof window !== "undefined")
    savePrincipalArray(userKey, workSessionsStorageKey(userKey), "kova-work-sessions-none", values);
}
