import type { TaskConnectionGrant } from "./scheduled-task-connected.server";
export class TaskEventAccessError extends Error {}
export class TaskEventResyncError extends Error {}
export function createTaskEventRuntime(input: {
  rpc: (operation: string, data: Record<string, unknown>) => Promise<unknown>;
  admit: (grantId: string, eventKey: string, event: Record<string, unknown>) => Promise<unknown>;
  checkCurrent: (grant: TaskConnectionGrant, signal: AbortSignal) => Promise<void>;
  getToken: (grant: TaskConnectionGrant, signal: AbortSignal) => Promise<string>;
  fetchImpl?: typeof fetch;
}): {
  pump: (input: { signal: AbortSignal; limit?: number }) => Promise<{ processed: number }>;
  initialize: (
    grant: TaskConnectionGrant,
    input: { expectedRevision: number; watch?: boolean; topic?: string },
    signal: AbortSignal,
  ) => Promise<{ ok: boolean }>;
  renewWatch: (
    grant: TaskConnectionGrant,
    cursor: { revision: number },
    topic: string,
    signal: AbortSignal,
    token?: string,
  ) => Promise<void>;
};
