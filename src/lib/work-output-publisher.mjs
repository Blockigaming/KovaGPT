import { workUuid } from "./work-execution-protocol.mjs";
import { sha256Hex } from "./project-files-policy.mjs";

const EXTENSIONS = {
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** A descriptor alone is never authority; transport bytes and Storage are both verified. */
export async function publishWorkProjectOutput(dependencies, run, receipt, output) {
  if (
    !run.request.projectId ||
    run.status !== "running" ||
    receipt.ownerId !== run.ownerId ||
    receipt.runId !== run.id ||
    (receipt.epoch !== run.epoch &&
      !(run.step?.epoch === receipt.epoch && run.step.id === receipt.stepId)) ||
    !run.stepIds.includes(receipt.stepId) ||
    !/^[a-f0-9]{64}$/.test(receipt.inputHash ?? "")
  )
    throw new Error("work_output_binding_invalid");
  workUuid(run.request.projectId);
  workUuid(output.artifactId);
  const extension = EXTENSIONS[output.mimeType];
  if (!extension) throw new Error("work_output_type_invalid");
  await dependencies.assertLease(run);
  const publishedFile = await dependencies.findPublishedFile?.(run, receipt, output);
  if (publishedFile) {
    // The binding RPC rechecks the current ready file, access and digest. Already
    // published immutable artifacts do not consume another transfer on recovery.
    return dependencies.bindOutput(run, receipt, output, workUuid(publishedFile));
  }
  const artifact = await dependencies.readArtifact(receipt, output);
  if (
    !(artifact.content instanceof Uint8Array) ||
    artifact.content.byteLength !== output.bytes ||
    (await sha256Hex(artifact.content)) !== output.sha256 ||
    artifact.ownerId !== run.ownerId ||
    artifact.runId !== run.id ||
    artifact.epoch !== receipt.epoch ||
    artifact.stepId !== receipt.stepId ||
    artifact.inputHash !== receipt.inputHash
  )
    throw new Error("work_output_bytes_invalid");
  await dependencies.assertLease(run);
  const file = await dependencies.publishProjectFile(
    {
      projectId: run.request.projectId,
      fileName: `work-${output.artifactId}.${extension}`,
      requestedKind: output.mimeType.startsWith("image/") ? "image" : "file",
      idempotencyKey: output.artifactId,
    },
    artifact.content,
    true,
    { run, receipt, output },
  );
  if (!file || file.status !== "ready" || file.project_id !== run.request.projectId)
    throw new Error("work_output_storage_unconfirmed");
  await dependencies.assertLease(run);
  // The binding transaction independently checks current Project membership,
  // ready canonical file identity, digest, size, MIME, run and owner fences.
  return dependencies.bindOutput(run, receipt, output, file.id);
}
