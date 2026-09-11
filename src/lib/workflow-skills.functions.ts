import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  normalizeWorkflowSkillDraft,
  type WorkflowSkillDraft,
  type WorkflowSkillResource,
} from "@/lib/workflow-skills-policy.mjs";

const Id = z.string().uuid();
const MutationEnvelope = z.object({
  mutationId: Id,
  requestedAt: z.string().datetime({ offset: true }),
});
const Draft = z.custom<WorkflowSkillDraft>((value) => {
  try {
    normalizeWorkflowSkillDraft(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid workflow skill.");
const SkillMutation = MutationEnvelope.extend({
  id: Id,
  expectedRevision: z.number().int().positive(),
});

export type WorkflowSkillCard = {
  id: string;
  revision: number;
  headVersionId: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  resources: WorkflowSkillResource[];
  digest: string;
  installationId: string | null;
  installedVersionId: string | null;
  installedVersion: number | null;
  installedName: string | null;
  created_at: string;
  updated_at: string;
};

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => RpcResult;
};

const Resource = z.object({
  title: z.string(),
  content: z.string(),
});
const Card = z.object({
  id: Id,
  revision: z.number().int().positive(),
  headVersionId: Id,
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  resources: z.array(Resource),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  installationId: Id.nullable(),
  installedVersionId: Id.nullable(),
  installedVersion: z.number().int().positive().nullable(),
  installedName: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

function rpc(client: unknown, name: string, args: Record<string, unknown>) {
  return (client as RpcClient).rpc(name, args);
}

function safeMutationError(error: { message?: string } | null): Error {
  const message = error?.message ?? "";
  if (message.includes("workflow_skill_conflict"))
    return new Error("This workflow skill changed elsewhere. Reload and try again.");
  if (message.includes("workflow_skill_capacity"))
    return new Error("Your workflow skill limit has been reached.");
  if (message.includes("workflow_skill_version_limit"))
    return new Error("This workflow skill has reached its version limit.");
  if (message.includes("workflow_skill_too_large"))
    return new Error("This workflow skill is too large.");
  if (message.includes("workflow_skill_storage_limit"))
    return new Error("Your account storage limit has been reached.");
  if (message.includes("workflow_skill_version_unavailable"))
    return new Error("That workflow skill version is no longer available.");
  return new Error("The workflow skill could not be saved.");
}

function mutationArgs(
  action: string,
  input: { mutationId: string; requestedAt: string },
  options: {
    id?: string | null;
    expectedRevision?: number;
    payload?: Record<string, unknown>;
  } = {},
) {
  return {
    p_action: action,
    p_skill_id: options.id ?? null,
    p_expected_revision: options.expectedRevision ?? 0,
    p_payload: options.payload ?? {},
    p_mutation_id: input.mutationId,
    p_requested_at: input.requestedAt,
  };
}

async function draftPayload(draft: WorkflowSkillDraft) {
  const normalized = normalizeWorkflowSkillDraft(draft);
  const { workflowSkillDigest } = await import("@/lib/workflow-skills-digest.server.mjs");
  return {
    name: normalized.name,
    description: normalized.description,
    instructions: normalized.instructions,
    resources: normalized.resources,
    digest: workflowSkillDigest(normalized),
  };
}

export const listWorkflowSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkflowSkillCard[]> => {
    const result = await rpc(context.supabase, "list_workflow_skills", {});
    if (result.error) throw new Error("Workflow skills could not be loaded.");
    const parsed = z.object({ rows: z.array(Card).max(100) }).safeParse(result.data);
    if (!parsed.success) throw new Error("Workflow skills returned an invalid response.");
    return parsed.data.rows;
  });

export const createWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MutationEnvelope.extend({ draft: Draft }).parse(input))
  .handler(async ({ data, context }) => {
    const result = await rpc(
      context.supabase,
      "mutate_workflow_skill",
      mutationArgs("create", data, { payload: await draftPayload(data.draft) }),
    );
    if (result.error) throw safeMutationError(result.error);
    return { ok: true as const };
  });

export const createWorkflowSkillVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.extend({ draft: Draft }).parse(input))
  .handler(async ({ data, context }) => {
    const result = await rpc(
      context.supabase,
      "mutate_workflow_skill",
      mutationArgs("version", data, {
        id: data.id,
        expectedRevision: data.expectedRevision,
        payload: await draftPayload(data.draft),
      }),
    );
    if (result.error) throw safeMutationError(result.error);
    return { ok: true as const };
  });

export const installWorkflowSkillVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.extend({ versionId: Id }).parse(input))
  .handler(async ({ data, context }) => {
    const result = await rpc(
      context.supabase,
      "mutate_workflow_skill",
      mutationArgs("install", data, {
        id: data.id,
        expectedRevision: data.expectedRevision,
        payload: { versionId: data.versionId },
      }),
    );
    if (result.error) throw safeMutationError(result.error);
    return { ok: true as const };
  });

export const uninstallWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.parse(input))
  .handler(async ({ data, context }) => {
    const result = await rpc(
      context.supabase,
      "mutate_workflow_skill",
      mutationArgs("uninstall", data, { id: data.id, expectedRevision: data.expectedRevision }),
    );
    if (result.error) throw safeMutationError(result.error);
    return { ok: true as const };
  });

export const deleteWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.parse(input))
  .handler(async ({ data, context }) => {
    const result = await rpc(
      context.supabase,
      "mutate_workflow_skill",
      mutationArgs("delete", data, { id: data.id, expectedRevision: data.expectedRevision }),
    );
    if (result.error) throw safeMutationError(result.error);
    return { ok: true as const };
  });
