import type {
  WorkModelCapability,
  WorkModelMode,
  WorkReasoningEffort,
  WorkModelSelection,
} from "./work-model-policy.mjs";
export const WORK_EXECUTION_PROTOCOL: "kova-work-v1";
export const WORK_RUNNER_CAPABILITIES: readonly string[];
export const WORK_TERMINAL: readonly string[];
export type WorkRunner = {
  id: string;
  protocol: string;
  build: string;
  authenticated: boolean;
  enabled: boolean;
  heartbeatAt: number;
  expiresAt: number;
  capabilities: string[];
  modelCapabilities?: WorkModelCapability[];
};
export type WorkSubmission = {
  mode: WorkModelMode;
  reasoningEffort: WorkReasoningEffort | null;
  mutationId: string;
  objective: string;
  source: "chat" | "work";
  sessionId: string | null;
  projectId: string | null;
  sessionRevision: number | null;
};
export type WorkRun = {
  protocol: string;
  id: string;
  ownerId: string;
  requestHash: string;
  request: WorkSubmission;
  sessionContext: Record<string, unknown> | null;
  model: string;
  modelSelection?: WorkModelSelection;
  premium: boolean;
  plan: "plus" | "pro";
  runnerId: string;
  runnerBuild: string;
  status: string;
  revision: number;
  epoch: number;
  createdAt: number;
  updatedAt: number;
  deadline: number;
  lease: { expiresAt: number } | null;
  limits: { maxActions: number; maxTokens: number; maxCostMicros: number; runtimeMs: number };
  usage: { actions: number; tokens: number; costMicros: number };
  directions: { id: string; text: string; at: number }[];
  question: { id: string; text: string; answer: string | null } | null;
  approval: {
    id: string;
    action: string;
    canonicalInput: string;
    inputHash: string;
    revision: number;
    expiresAt: number;
    status: string;
  } | null;
  effect: {
    id: string;
    status: string;
    epoch: number;
    inputHash: string;
    result?: Record<string, unknown>;
  } | null;
  step: {
    id: string;
    reservationId: string;
    epoch: number;
    startedAt: number;
    input: Record<string, unknown>;
    inputHash: string;
    tokens: number;
    costMicros: number;
    receipt?: import("./work-runner-transport.mjs").RunnerReceipt;
  } | null;
  reservationIds: string[];
  reconciling: boolean;
  stepIds: string[];
  outputRefs: { kind: "library"; id: string }[];
  evidence: string[];
  event: { kind: string; at: number; detail: Record<string, unknown> };
};
export function workUuid(value: unknown): string;
export function canonicalWorkInput(value: unknown): string;
export function workInputHash(value: unknown): Promise<string>;
export function workStepInput(
  run: WorkRun,
  stepId: string,
  cost: Record<string, unknown>,
): Record<string, unknown>;
export function runnerReady(runner: WorkRunner | null | undefined, now?: number): boolean;
export function parseWorkSubmission(input: unknown): WorkSubmission;
export function admitWorkRun(
  input: unknown,
  policy: {
    runId: string;
    ownerId: string;
    model: string;
    modelSelection?: WorkModelSelection;
    premium?: boolean;
    sessionContext?: Record<string, unknown> | null;
    plan: "plus" | "pro";
    accountActive: boolean;
    lockdownAllowed: boolean;
    costAllowed: boolean;
    maxActions: number;
    maxTokens: number;
    maxCostMicros: number;
    runtimeMs: number;
  },
  runner: WorkRunner | null,
  now?: number,
): Promise<WorkRun>;
export function transitionWorkRun(
  run: WorkRun,
  command: Record<string, unknown>,
  context: Record<string, unknown>,
  now?: number,
): Promise<WorkRun>;
export function reconcileWorkRun(
  run: WorkRun,
  evidence: Record<string, unknown>,
  now?: number,
): WorkRun;

export function reconcileUndispatchedWorkRun(
  previous: WorkRun,
  attempt: import("./work-runner-transport.mjs").RunnerAttempt,
  accountingSettled: boolean,
  now?: number,
): WorkRun;
