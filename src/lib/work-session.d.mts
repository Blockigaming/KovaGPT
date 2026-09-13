export type WorkSessionStep = { id: string; text: string; done: boolean };
export type WorkSessionEvent = {
  id: string;
  at: number;
  kind:
    | "created"
    | "branched"
    | "plan_updated"
    | "step_updated"
    | "status_updated"
    | "conflict_resolved";
  label: string;
};
export type WorkSession = Record<string, unknown> & {
  id: string;
  rootId: string;
  parent: { id: string; revision: number } | null;
  objective: string;
  context: string;
  steps: WorkSessionStep[];
  status: "planning" | "paused" | "completed";
  createdAt: number;
  updatedAt: number;
  events: WorkSessionEvent[];
};
export const MAX_SESSION_EVENTS: number;
export function validWorkSession(value: unknown): value is WorkSession;
export function createWorkSession(
  input: { objective: string; context?: string; plan?: string[] },
  now?: number,
): WorkSession;
export function updateWorkSession(
  session: WorkSession,
  changes: Partial<Pick<WorkSession, "objective" | "context" | "steps" | "status">>,
  kind: WorkSessionEvent["kind"],
  label: string,
  now?: number,
): WorkSession;
export function branchWorkSession(
  session: WorkSession,
  revision: number,
  now?: number,
): WorkSession;
export function mergeWorkSessionHistory(account: WorkSession, device: WorkSession): WorkSession;
