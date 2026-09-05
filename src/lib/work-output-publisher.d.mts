import type { WorkRun } from "./work-execution-protocol.mjs";
import type { RunnerReceipt, RunnerOutput, AttemptBinding } from "./work-runner-transport.mjs";
export function publishWorkProjectOutput(
  dependencies: {
    assertLease(run: WorkRun): Promise<void>;
    findPublishedFile?(
      run: WorkRun,
      receipt: RunnerReceipt,
      output: RunnerOutput,
    ): Promise<string | null>;
    readArtifact(
      receipt: AttemptBinding,
      output: RunnerOutput,
    ): Promise<RunnerOutput & AttemptBinding & { content: Uint8Array }>;
    publishProjectFile(
      metadata: {
        projectId: string;
        fileName: string;
        requestedKind: "file" | "image";
        idempotencyKey: string;
      },
      bytes: Uint8Array,
      verify: boolean,
      proof: { run: WorkRun; receipt: RunnerReceipt; output: RunnerOutput },
    ): Promise<{ id: string; status: string; project_id: string }>;
    bindOutput(
      run: WorkRun,
      receipt: RunnerReceipt,
      output: RunnerOutput,
      fileId: string,
    ): Promise<{ kind: "library"; id: string }>;
  },
  run: WorkRun,
  receipt: RunnerReceipt,
  output: RunnerOutput,
): Promise<{ kind: "library"; id: string }>;
