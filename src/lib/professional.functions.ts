import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
type Query = {
  select: (columns?: string) => Query;
  insert: (value: unknown) => Query;
  update: (value: unknown) => Query;
  delete: () => Query;
  eq: (key: string, value: unknown) => Query;
  in: (key: string, values: unknown[]) => Query;
  order: (key: string, options?: unknown) => Query;
  limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
};
const t = (s: unknown, n: string) => (s as { from: (name: string) => Query }).from(n);

export type ProjectComment = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  anchor: string | null;
  mentions: string[];
  created_at: string;
  updated_at: string;
};
const commentsRpc = async (client: unknown, operation: string, data: Record<string, unknown>) => {
  const { data: result, error } = await (
    client as {
      rpc: (
        name: string,
        parameters: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("collaboration_rpc", { p_operation: operation, p_data: data });
  if (error || !Array.isArray(result)) throw new Error("Comments could not be updated");
  return result as ProjectComment[];
};
export const listProjectComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ project_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ProjectComment[]> =>
    commentsRpc(context.supabase, "project_comments", { projectId: data.project_id }),
  );
export const addProjectComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        anchor: z.string().trim().max(200).nullable().optional(),
        mentions: z.array(z.string().uuid()).max(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectComment> => {
    const commentId = crypto.randomUUID();
    const rows = await commentsRpc(context.supabase, "project_comment", {
      projectId: data.project_id,
      commentId,
      body: data.body,
      anchor: data.anchor ?? null,
      mentions: data.mentions,
    });
    const row = rows.find((comment) => comment.id === commentId);
    if (!row) throw new Error("Comment could not be posted");
    return row;
  });
export const deleteProjectComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // The existing API accepts an id; its RLS-scoped lookup supplies the Project.
    const { data: value, error } = await t(context.supabase, "project_comments")
      .select("project_id")
      .eq("id", data.id)
      .single();
    const row = z.object({ project_id: z.string().uuid() }).safeParse(value);
    if (error || !row.success) throw new Error("Comment could not be deleted");
    await commentsRpc(context.supabase, "project_comment_delete", {
      projectId: row.data.project_id,
      commentId: data.id,
    });
    return { ok: true };
  });

const PromptInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(12000),
  variables: z.array(z.string().trim().min(1).max(60)).max(30),
  project_id: z.string().uuid().nullable().optional(),
  context_pack_id: z.string().uuid().nullable().optional(),
  favorite: z.boolean().default(false),
  folder: z.string().trim().min(1).max(80).default("Unfiled"),
});
export type PromptTemplate = z.infer<typeof PromptInput> & {
  id: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  use_count: number;
};
export const listPromptTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromptTemplate[]> => {
    const { data, error } = await t(context.supabase, "prompt_templates")
      .select(
        "id,name,category,body,variables,project_id,context_pack_id,favorite,folder,use_count,last_used_at,created_at,updated_at",
      )
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Prompts could not be loaded");
    return (data ?? []) as PromptTemplate[];
  });
export const savePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => PromptInput.parse(i))
  .handler(async ({ data, context }): Promise<PromptTemplate> => {
    const { data: row, error } = await t(context.supabase, "prompt_templates")
      .insert({ ...data, user_id: context.userId })
      .select(
        "id,name,category,body,variables,project_id,context_pack_id,favorite,folder,use_count,last_used_at,created_at,updated_at",
      )
      .single();
    if (error || !row) throw new Error("Prompt could not be saved");
    return row as PromptTemplate;
  });
export const updatePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        favorite: z.boolean().optional(),
        last_used_at: z.string().datetime().optional(),
        name: z.string().trim().min(1).max(120).optional(),
        body: z.string().trim().min(1).max(12000).optional(),
        variables: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
        folder: z.string().trim().min(1).max(80).optional(),
        increment_use: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, increment_use, ...changes } = data;
    const existing = await t(context.supabase, "prompt_templates")
      .select("id,name,body,variables,use_count")
      .eq("id", id)
      .eq("user_id", context.userId)
      .single();
    if (existing.error || !existing.data) throw new Error("Prompt could not be updated");
    const current = existing.data as Record<string, unknown>;
    if (changes.body || changes.name) {
      const versions = await t(context.supabase, "prompt_versions")
        .select("id,version")
        .eq("prompt_id", id)
        .order("version", { ascending: false })
        .limit(1);
      const latest = ((versions.data ?? [])[0] as Record<string, unknown> | undefined)?.version;
      const snapshot = await t(context.supabase, "prompt_versions")
        .insert({
          prompt_id: id,
          user_id: context.userId,
          version: Number(latest ?? 0) + 1,
          name: String(current.name),
          body: String(current.body),
          variables: current.variables,
        })
        .select("id")
        .single();
      if (snapshot.error) throw new Error("Prompt revision could not be recorded");
    }
    const persisted = {
      ...changes,
      ...(increment_use ? { use_count: Number(current.use_count ?? 0) + 1 } : {}),
      updated_at: new Date().toISOString(),
    };
    const { error } = await t(context.supabase, "prompt_templates")
      .update(persisted)
      .eq("id", id)
      .eq("user_id", context.userId)
      .select("id")
      .single();
    if (error) throw new Error("Prompt could not be updated");
    return { ok: true };
  });

export type PromptVersion = {
  id: string;
  prompt_id: string;
  version: number;
  name: string;
  body: string;
  variables: string[];
  created_at: string;
};
export type PromptEvaluation = {
  id: string;
  prompt_id: string;
  rating: number;
  notes: string;
  created_at: string;
};
export const listPromptHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ prompt_id: z.string().uuid() }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ versions: PromptVersion[]; evaluations: PromptEvaluation[] }> => {
      const [versions, evaluations] = await Promise.all([
        t(context.supabase, "prompt_versions")
          .select("id,prompt_id,version,name,body,variables,created_at")
          .eq("prompt_id", data.prompt_id)
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false })
          .limit(50),
        t(context.supabase, "prompt_evaluations")
          .select("id,prompt_id,rating,notes,created_at")
          .eq("prompt_id", data.prompt_id)
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (versions.error || evaluations.error)
        throw new Error("Prompt history could not be loaded");
      return {
        versions: (versions.data ?? []) as PromptVersion[],
        evaluations: (evaluations.data ?? []) as PromptEvaluation[],
      };
    },
  );
export const evaluatePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        prompt_id: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        notes: z.string().trim().max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PromptEvaluation> => {
    const { data: row, error } = await t(context.supabase, "prompt_evaluations")
      .insert({ ...data, user_id: context.userId })
      .select("id,prompt_id,rating,notes,created_at")
      .single();
    if (error || !row) throw new Error("Evaluation could not be saved");
    return row as PromptEvaluation;
  });
export const deletePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await t(context.supabase, "prompt_templates")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id")
      .single();
    if (error) throw new Error("Prompt could not be deleted");
    return { ok: true };
  });

const ResearchInput = z.object({
  name: z.string().trim().min(1).max(120),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  allowed_sites: z.array(z.string().trim().max(200)).max(30),
  source_preference: z.enum(["balanced", "primary", "academic", "recent"]),
});
export type ResearchTemplate = z.infer<typeof ResearchInput> & {
  id: string;
  created_at: string;
  updated_at: string;
};
export const listResearchTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResearchTemplate[]> => {
    const { data, error } = await t(context.supabase, "research_templates")
      .select("id,name,steps,allowed_sites,source_preference,created_at,updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Research templates could not be loaded");
    return (data ?? []) as ResearchTemplate[];
  });
export const saveResearchTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => ResearchInput.parse(i))
  .handler(async ({ data, context }): Promise<ResearchTemplate> => {
    const { data: row, error } = await t(context.supabase, "research_templates")
      .insert({ ...data, user_id: context.userId })
      .select("id,name,steps,allowed_sites,source_preference,created_at,updated_at")
      .single();
    if (error || !row) throw new Error("Research template could not be saved");
    return row as ResearchTemplate;
  });

export type KnowledgeNode = {
  id: string;
  kind: "project" | "chat" | "file" | "artifact" | "memory" | "context";
  label: string;
  href: string;
  projectId?: string;
  updatedAt: string;
};
export type KnowledgeEdge = { source: string; target: string; reason: string; strength: number };
export const listKnowledgeGraph = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> => {
    const [projects, chats, files, library, memories, packs] = await Promise.all([
      t(context.supabase, "projects")
        .select("id,name,updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
      t(context.supabase, "project_chats")
        .select("id,project_id,title,updated_at")
        .order("updated_at", { ascending: false })
        .limit(100),
      t(context.supabase, "project_files")
        .select("id,project_id,name,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      t(context.supabase, "user_library_items")
        .select("id,title,item_type,created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(100),
      t(context.supabase, "project_memory")
        .select("id,project_id,content,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      t(context.supabase, "context_packs")
        .select("id,name,items,updated_at")
        .eq("user_id", context.userId)
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);
    const failed = [projects, chats, files, library, memories, packs].find(
      (result) => result.error,
    );
    if (failed?.error) throw new Error("Knowledge graph could not be loaded");
    const nodes: KnowledgeNode[] = [];
    const edges: KnowledgeEdge[] = [];
    for (const row of (projects.data ?? []) as Record<string, unknown>[])
      nodes.push({
        id: `project:${row.id}`,
        kind: "project",
        label: String(row.name),
        href: `/projects/${row.id}`,
        updatedAt: String(row.updated_at),
      });
    for (const row of (chats.data ?? []) as Record<string, unknown>[]) {
      nodes.push({
        id: `chat:${row.id}`,
        kind: "chat",
        label: String(row.title),
        href: `/projects/${row.project_id}/chat/${row.id}`,
        projectId: String(row.project_id),
        updatedAt: String(row.updated_at),
      });
      edges.push({
        source: `project:${row.project_id}`,
        target: `chat:${row.id}`,
        reason: "Project chat",
        strength: 1,
      });
    }
    for (const row of (files.data ?? []) as Record<string, unknown>[]) {
      nodes.push({
        id: `file:${row.id}`,
        kind: "file",
        label: String(row.name),
        href: `/projects/${row.project_id}`,
        projectId: String(row.project_id),
        updatedAt: String(row.created_at),
      });
      edges.push({
        source: `project:${row.project_id}`,
        target: `file:${row.id}`,
        reason: "Project file",
        strength: 1,
      });
    }
    for (const row of (library.data ?? []) as Record<string, unknown>[])
      nodes.push({
        id: `library:${row.id}`,
        kind:
          String(row.item_type).includes("artifact") ||
          ["document", "code", "website_draft"].includes(String(row.item_type))
            ? "artifact"
            : "file",
        label: String(row.title),
        href: "/library",
        updatedAt: String(row.created_at),
      });
    for (const row of (memories.data ?? []) as Record<string, unknown>[]) {
      nodes.push({
        id: `memory:${row.id}`,
        kind: "memory",
        label: String(row.content).slice(0, 70),
        href: "/memory",
        projectId: String(row.project_id),
        updatedAt: String(row.created_at),
      });
      edges.push({
        source: `project:${row.project_id}`,
        target: `memory:${row.id}`,
        reason: "Project memory",
        strength: 1,
      });
    }
    for (const row of (packs.data ?? []) as Record<string, unknown>[]) {
      const id = `context:${row.id}`;
      nodes.push({
        id,
        kind: "context",
        label: String(row.name),
        href: "/context-packs",
        updatedAt: String(row.updated_at),
      });
      for (const item of (Array.isArray(row.items) ? row.items : []) as Record<string, unknown>[]) {
        const candidates = [`${item.type}:${item.id}`, `library:${item.id}`];
        const target = candidates.find((value) => nodes.some((node) => node.id === value));
        if (target)
          edges.push({ source: id, target, reason: "Included in context pack", strength: 1 });
      }
    }
    const relationships = new Map<string, KnowledgeEdge>();
    for (const edge of edges) {
      const key = `${edge.source}:${edge.target}:${edge.reason}`;
      const existing = relationships.get(key);
      relationships.set(key, existing ? { ...existing, strength: existing.strength + 1 } : edge);
    }
    return { nodes, edges: [...relationships.values()] };
  });
