export const WORK_SYNC_MAX_BODY_BYTES: number;
export const WORK_SYNC_MAX_PAYLOAD_BYTES: number;
export const WORK_SYNC_MAX_CHANGES: number;

export class WorkSyncInputError extends Error {
  code: string;
  constructor(code: string);
}

export type WorkSyncMutation =
  | {
      action: "save";
      mutationId: string;
      id: string;
      kind: "task" | "template" | "agent_draft";
      title: string;
      payload: Record<string, unknown>;
      expectedRevision: number;
    }
  | {
      action: "delete";
      mutationId: string;
      id: string;
      expectedRevision: number;
    }
  | {
      action: "recent";
      mutationId: string;
      resourceType: "run" | "task" | "template" | "agent_draft";
      resourceId: string;
      pin: "keep" | "pin" | "unpin" | "forget";
      expectedRevision: number | null;
    };

export function parseWorkSyncMutation(value: unknown): WorkSyncMutation;
export function parseWorkSyncQuery(value: string | URL): { cursor: number; limit: number };
export function workSyncErrorStatus(code?: string | null): number;
