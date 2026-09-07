import type { WorkRun, WorkRunner } from "./work-execution-protocol.mjs";
import type { RunnerReceipt } from "./work-runner-transport.mjs";
export type WorkCostReservation = {
  id: string;
  ownerId: string;
  runId: string;
  epoch: number;
  model: string;
  tokens: number;
  outputTokens: number;
  costMicros: number;
  verified: boolean;
  expiresAt: number;
};
export function executeIsolatedWorkStep(
  dependencies: {
    repository: {
      load(id: string): Promise<WorkRun>;
      authorize(run: WorkRun): Promise<void>;
      assertLease(run: WorkRun): Promise<void>;
      commit(run: WorkRun, expected: number, mutation: string): Promise<WorkRun>;
    };
    adapter: {
      attestation(): Promise<WorkRunner>;
      reason(
        input: Record<string, unknown>,
        guards: { signal: AbortSignal; assertLease(): Promise<void> },
      ): Promise<RunnerReceipt>;
    };
    costBroker: {
      reserve(run: WorkRun, stepId: string): Promise<WorkCostReservation>;
      releaseUnused(reservation: WorkCostReservation): Promise<void>;
      settle(run: WorkRun, receipt: RunnerReceipt): Promise<void>;
    };
  },
  runId: string,
  stepId: string,
): Promise<{ state: WorkRun; receipt: RunnerReceipt; budgetViolation: boolean }>;
