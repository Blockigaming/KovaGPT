import type { WorkRunner } from "./work-execution-protocol.mjs";
export const WORK_ARTIFACT_MAX_BYTES: number;
export type RunnerConfiguration = {
  origin: string;
  id: string;
  build: string;
  token: string;
  signingKey: string;
};
export type AttemptBinding = {
  runId: string;
  ownerId: string;
  epoch: number;
  stepId: string;
  inputHash: string;
};
export type RunnerOutput = { artifactId: string; sha256: string; mimeType: string; bytes: number };
export type RunnerReceipt = AttemptBinding & {
  reservationId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  costMicros: number;
  outputs: RunnerOutput[];
  directive?:
    | { kind: "question"; id: string; text: string }
    | { kind: "approval"; id: string; action: string; input: unknown }
    | {
        kind: "effect_result";
        id: string;
        outcome: "completed" | "not_executed" | "failed";
        result?: Record<string, unknown>;
      }
    | { kind: "failure"; reason: string };
};
export type RunnerAttempt = AttemptBinding & {
  attemptId?: string;
  status:
    | "accepted"
    | "running"
    | "completed"
    | "question"
    | "approval_required"
    | "effect_completed"
    | "cancelled"
    | "failed"
    | "unknown"
    | "not_executed";
  receipt?: RunnerReceipt;
};
export function parseWorkRunnerConfiguration(input: unknown): RunnerConfiguration | null;
export function signRunnerEnvelope(
  secret: string,
  direction: "request" | "response",
  body: string,
): Promise<string>;
export function verifyRunnerInvocation(
  configuration: RunnerConfiguration,
  raw: string,
  signature: string | null,
): Promise<{
  operation: "dispatch" | "recover" | "drain" | "probe";
  runId: string | null;
  requestId: string;
}>;
export function createWorkRunnerTransport(
  configuration: RunnerConfiguration,
  fetcher?: typeof fetch,
): {
  heartbeat(signal?: AbortSignal): Promise<WorkRunner>;
  cleanupOwner(ownerId: string, signal?: AbortSignal): Promise<boolean>;
  dispatch(
    input: { runId: string; ownerId: string; requestHash: string },
    signal?: AbortSignal,
  ): Promise<unknown>;
  submit(input: Record<string, unknown>, signal?: AbortSignal): Promise<RunnerAttempt>;
  status(input: AttemptBinding, signal?: AbortSignal): Promise<RunnerAttempt>;
  cancel(input: AttemptBinding, signal?: AbortSignal): Promise<RunnerAttempt>;
  reconcile(input: AttemptBinding, signal?: AbortSignal): Promise<RunnerAttempt>;
  sealUndispatched(
    input: AttemptBinding & { reservationId: string },
    signal?: AbortSignal,
  ): Promise<RunnerAttempt>;
  artifact(
    input: AttemptBinding,
    output: RunnerOutput,
    signal?: AbortSignal,
  ): Promise<RunnerOutput & AttemptBinding & { content: Uint8Array }>;
};

export function workRunnerMatchesOwnerHistory(
  configuration: RunnerConfiguration | null,
  records: unknown,
): boolean;
