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
  digest: string;
  installationId: string | null;
  installedVersionId: string | null;
  installedVersion: number | null;
  installedName: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowSkillVersionSummary = {
  id: string;
  version: number;
  name: string;
  digest: string;
  created_at: string;
};

export type WorkflowSkillDetail = WorkflowSkillCard & {
  instructions: string;
  resources: WorkflowSkillResource[];
  versions: WorkflowSkillVersionSummary[];
};

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => RpcResult;
};
type VersionHistoryQuery = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> & {
  eq: (column: string, value: string) => VersionHistoryQuery;
  order: (column: string, options: { ascending: boolean }) => VersionHistoryQuery;
  limit: (count: number) => VersionHistoryQuery;
};
type VersionHistoryClient = {
  from: (relation: string) => {
    select: (columns: string) => VersionHistoryQuery;
  };
};

const Resource = z.object({
  title: z.string(),
  content: z.string(),
});
const VersionSummary = z
  .object({
    id: Id,
    version: z.number().int().positive(),
    name: z.string(),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    created_at: z.string(),
  })
  .strict();
const VersionHistory = z
  .array(VersionSummary)
  .min(1)
  .max(30)
  .refine(
    (versions) =>
      versions.every(
        (version, index) => index === 0 || versions[index - 1].version > version.version,
      ),
    "Workflow skill versions must be unique and newest first.",
  );
const Card = z.object({
  id: Id,
  revision: z.number().int().positive(),
  headVersionId: Id,
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  installationId: Id.nullable(),
  installedVersionId: Id.nullable(),
  installedVersion: z.number().int().positive().nullable(),
  installedName: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const Detail = Card.extend({
  instructions: z.string(),
  resources: z.array(Resource),
});
const Cursor = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    id: Id,
  })
  .strict();
const Page = z
  .object({
    rows: z.array(Card).max(20),
    nextCursor: Cursor.nullable(),
  })
  .strict();
const MutationAuthorization = z
  .object({
    allowed: z.boolean(),
    replay: z.boolean(),
    retryAfter: z.number().int().nonnegative(),
  })
  .strict();

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
  if (message.includes("workflow_skill_export_limit"))
    return new Error("Your workflow skill history has reached its export-safe limit.");
  if (message.includes("workflow_skill_rate_limit"))
    return new Error("Too many workflow skill changes. Try again later.");
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

async function runWorkflowSkillMutation(
  userId: string,
  action: "create" | "version" | "install" | "uninstall" | "delete",
  args: ReturnType<typeof mutationArgs>,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // These are deliberately separate PostgREST requests. Authorization commits
  // its rate token before the mutation can begin, and authenticated callers do
  // not have EXECUTE on either service-only database function.
  const authorization = await rpc(supabaseAdmin, "authorize_workflow_skill_mutation", {
    p_actor: userId,
    p_action: action,
    p_mutation_id: args.p_mutation_id,
  });
  if (authorization.error) throw safeMutationError(authorization.error);
  const parsed = MutationAuthorization.safeParse(authorization.data);
  if (!parsed.success) throw new Error("The workflow skill could not be saved.");
  if (!parsed.data.allowed) throw safeMutationError({ message: "workflow_skill_rate_limit" });

  const result = await rpc(supabaseAdmin, "mutate_workflow_skill", {
    p_actor: userId,
    ...args,
  });
  if (result.error) throw safeMutationError(result.error);
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
    const rows: WorkflowSkillCard[] = [];
    let before: z.infer<typeof Cursor> | null = null;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const result = await rpc(context.supabase, "list_workflow_skills", {
        p_limit: 20,
        p_before_updated_at: before?.updatedAt ?? null,
        p_before_id: before?.id ?? null,
      });
      if (result.error) throw new Error("Workflow skills could not be loaded.");
      const parsed = Page.safeParse(result.data);
      if (!parsed.success) throw new Error("Workflow skills returned an invalid response.");
      rows.push(...parsed.data.rows);
      before = parsed.data.nextCursor;
      if (!before) break;
    }
    return rows;
  });

export const getWorkflowSkill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id }).strict().parse(input))
  .handler(async ({ data, context }): Promise<WorkflowSkillDetail> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await rpc(supabaseAdmin, "get_workflow_skill", {
      p_actor: context.userId,
      p_skill_id: data.id,
    });
    if (result.error) throw new Error("Workflow skill details could not be loaded.");
    const parsed = Detail.safeParse(result.data);
    if (!parsed.success) throw new Error("Workflow skill details returned an invalid response.");
    // The package body remains a single service-only RPC result. Version
    // history is a second, metadata-only service-role read, owner-scoped and
    // capped at the immutable 30-version package limit.
    const historyResult = await (supabaseAdmin as unknown as VersionHistoryClient)
      .from("workflow_skill_versions")
      .select("id, version, name, digest:content_sha256, created_at")
      .eq("owner_id", context.userId)
      .eq("skill_id", data.id)
      .order("version", { ascending: false })
      .limit(30);
    if (historyResult.error) throw new Error("Workflow skill version history could not be loaded.");
    const history = VersionHistory.safeParse(historyResult.data);
    if (!history.success)
      throw new Error("Workflow skill version history returned an invalid response.");
    // Require one coherent snapshot. A concurrent version creation between the
    // authorized detail RPC and this read must fail closed instead of exposing
    // a newer history row beside stale head metadata.
    const head = history.data[0];
    const installed = parsed.data.installedVersionId
      ? history.data.find((version) => version.id === parsed.data.installedVersionId)
      : null;
    if (
      !head ||
      head.id !== parsed.data.headVersionId ||
      head.version !== parsed.data.version ||
      head.name !== parsed.data.name ||
      head.digest !== parsed.data.digest ||
      (parsed.data.installedVersionId === null
        ? parsed.data.installedVersion !== null || parsed.data.installedName !== null
        : !installed ||
          installed.version !== parsed.data.installedVersion ||
          installed.name !== parsed.data.installedName)
    )
      throw new Error("Workflow skill version history returned an invalid response.");
    return { ...parsed.data, versions: history.data };
  });

export const createWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MutationEnvelope.extend({ draft: Draft }).parse(input))
  .handler(async ({ data, context }) => {
    await runWorkflowSkillMutation(
      context.userId,
      "create",
      mutationArgs("create", data, { payload: await draftPayload(data.draft) }),
    );
    return { ok: true as const };
  });

export const createWorkflowSkillVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.extend({ draft: Draft }).parse(input))
  .handler(async ({ data, context }) => {
    await runWorkflowSkillMutation(
      context.userId,
      "version",
      mutationArgs("version", data, {
        id: data.id,
        expectedRevision: data.expectedRevision,
        payload: await draftPayload(data.draft),
      }),
    );
    return { ok: true as const };
  });

export const installWorkflowSkillVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.extend({ versionId: Id }).parse(input))
  .handler(async ({ data, context }) => {
    await runWorkflowSkillMutation(
      context.userId,
      "install",
      mutationArgs("install", data, {
        id: data.id,
        expectedRevision: data.expectedRevision,
        payload: { versionId: data.versionId },
      }),
    );
    return { ok: true as const };
  });

export const uninstallWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.parse(input))
  .handler(async ({ data, context }) => {
    await runWorkflowSkillMutation(
      context.userId,
      "uninstall",
      mutationArgs("uninstall", data, { id: data.id, expectedRevision: data.expectedRevision }),
    );
    return { ok: true as const };
  });

export const deleteWorkflowSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SkillMutation.parse(input))
  .handler(async ({ data, context }) => {
    await runWorkflowSkillMutation(
      context.userId,
      "delete",
      mutationArgs("delete", data, { id: data.id, expectedRevision: data.expectedRevision }),
    );
    return { ok: true as const };
  });
