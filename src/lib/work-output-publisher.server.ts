import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";
import type { RunnerReceipt } from "@/lib/work-runner-transport.mjs";
import { configuredWorkRunnerAdapter } from "@/lib/work-runner.server";
import { createWorkExecutionRepository } from "@/lib/work-execution.server";
import { publishProjectFileBytes } from "@/routes/api/project-files";
import { publishWorkProjectOutput } from "@/lib/work-output-publisher.mjs";

export async function publishVerifiedWorkOutputs(
  caller: AuthedCaller,
  run: WorkRun,
  receipt: RunnerReceipt,
) {
  const adapter = configuredWorkRunnerAdapter();
  const repository = createWorkExecutionRepository(caller);
  const db = workExecutionDatabase(caller.supabaseAdmin);
  const outputs: { kind: "library"; id: string }[] = [];
  for (const output of receipt.outputs)
    outputs.push(
      await publishWorkProjectOutput(
        {
          assertLease: repository.assertLease,
          readArtifact: adapter.artifact,
          async findPublishedFile(current, verifiedReceipt, descriptor) {
            const { data, error } = await db
              .from("work_execution_outputs")
              .select("project_file_id")
              .eq("owner_id", caller.userId)
              .eq("run_id", current.id)
              .eq("artifact_id", descriptor.artifactId)
              .maybeSingle();
            if (error) throw new Error("work_output_binding_unavailable");
            return data?.project_file_id ?? null;
          },
          async publishProjectFile(metadata, bytes, verify, proof) {
            const result = await publishProjectFileBytes(
              caller,
              metadata,
              bytes,
              verify,
              async (fileId, attemptId) => {
                const { data, error } = await db.rpc("publish_work_project_file", {
                  p_owner_id: caller.userId,
                  p_run_id: proof.run.id,
                  p_epoch: proof.run.epoch,
                  p_receipt_epoch: proof.receipt.epoch,
                  p_step_id: proof.receipt.stepId,
                  p_input_hash: proof.receipt.inputHash,
                  p_project_file_id: fileId,
                  p_attempt_id: attemptId,
                  p_artifact_id: proof.output.artifactId,
                  p_sha256: proof.output.sha256,
                  p_size_bytes: proof.output.bytes,
                  p_mime_type: proof.output.mimeType,
                });
                return !error && data === true;
              },
            );
            if (!result.ok) throw new Error("work_output_storage_unavailable");
            const value = await result.json();
            return value.file;
          },
          async bindOutput(current, verifiedReceipt, descriptor, fileId) {
            const { data, error } = await db.rpc("publish_work_execution_output", {
              p_owner_id: caller.userId,
              p_run_id: current.id,
              p_epoch: current.epoch,
              p_receipt_epoch: verifiedReceipt.epoch,
              p_step_id: verifiedReceipt.stepId,
              p_input_hash: verifiedReceipt.inputHash,
              p_project_file_id: fileId,
              p_artifact_id: descriptor.artifactId,
              p_sha256: descriptor.sha256,
              p_size_bytes: descriptor.bytes,
              p_mime_type: descriptor.mimeType,
            });
            if (error || !data || typeof data.id !== "string")
              throw new Error("work_output_binding_unavailable");
            return { kind: "library", id: data.id };
          },
        },
        run,
        receipt,
        output,
      ),
    );
  return outputs;
}
