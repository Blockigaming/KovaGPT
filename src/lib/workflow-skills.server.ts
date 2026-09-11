import { buildWorkflowSkillBlock } from "@/lib/workflow-skills-digest.server.mjs";
import {
  normalizeWorkflowSkillSelection,
  type WorkflowSkillSelection,
} from "@/lib/workflow-skills-policy.mjs";

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
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

function unavailable(): Error {
  const error = new Error("workflow_skill_unavailable");
  error.name = "WorkflowSkillUnavailableError";
  return error;
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
  if (result.error || !result.data) throw unavailable();
  try {
    return buildWorkflowSkillBlock(result.data);
  } catch {
    throw unavailable();
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
    throw unavailable();
  }
  const resolved = await resolveRecord(admin, userId, selection, signal);
  return {
    ...resolved,
    assertCurrent: async (nextSignal) => {
      const current = await resolveRecord(admin, userId, selection, nextSignal);
      if (current.digest !== resolved.digest || current.versionId !== resolved.versionId)
        throw unavailable();
    },
  };
}
