import { buildWorkflowSkillBlock } from "@/lib/workflow-skills-digest.server.mjs";
import {
  normalizeWorkflowSkillSelection,
  type WorkflowSkillSelection,
} from "@/lib/workflow-skills-policy.mjs";

type RpcResult = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
type AbortableRpcResult = RpcResult & { abortSignal?: (signal: AbortSignal) => RpcResult };
type RpcAdmin = { rpc: (name: string, args: Record<string, unknown>) => AbortableRpcResult };

export type ResolvedWorkflowSkill = WorkflowSkillSelection & {
  skillId: string;
  version: number;
  name: string;
  digest: string;
  block: string;
  assertCurrent: (signal?: AbortSignal) => Promise<void>;
};

export class WorkflowSkillAccessError extends Error {
  readonly code = "workflow_skill_unavailable";
  readonly status: number;
  readonly retryable: boolean;
  readonly publicMessage: string;

  constructor(status = 403) {
    const message =
      status >= 500
        ? "Workflow skills are temporarily unavailable. Please try again."
        : "This workflow skill is no longer installed at that version. Choose an installed version before trying again.";
    super(message);
    this.name = "WorkflowSkillAccessError";
    this.status = status;
    this.retryable = status >= 500;
    this.publicMessage = message;
  }
}

async function resolveRecord(
  admin: unknown,
  userId: string,
  selection: WorkflowSkillSelection,
  signal?: AbortSignal,
) {
  const pending = (admin as RpcAdmin).rpc("resolve_workflow_skill", {
    p_actor: userId,
    p_installation_id: selection.installationId,
    p_version_id: selection.versionId,
  });
  const result = signal && pending.abortSignal ? await pending.abortSignal(signal) : await pending;
  if (result.error) throw new WorkflowSkillAccessError(result.error.code === "42501" ? 403 : 503);
  if (!result.data) throw new WorkflowSkillAccessError(503);
  try {
    return buildWorkflowSkillBlock(result.data);
  } catch {
    throw new WorkflowSkillAccessError(503);
  }
}

export async function resolveWorkflowSkill(
  admin: unknown,
  userId: string,
  candidate: unknown,
  signal?: AbortSignal,
): Promise<ResolvedWorkflowSkill> {
  let selection: WorkflowSkillSelection;
  try {
    selection = normalizeWorkflowSkillSelection(candidate);
  } catch {
    throw new WorkflowSkillAccessError();
  }
  const resolved = await resolveRecord(admin, userId, selection, signal);
  return {
    ...resolved,
    assertCurrent: async (nextSignal) => {
      const current = await resolveRecord(admin, userId, selection, nextSignal);
      if (current.digest !== resolved.digest || current.versionId !== resolved.versionId)
        throw new WorkflowSkillAccessError();
    },
  };
}
