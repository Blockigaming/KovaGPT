import { loose } from "@/lib/supabase-loose";
import {
  readCollectionPage,
  CollectionPageInput,
  type CollectionPage,
} from "@/lib/read-bounded-collection";
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
const SavedPrompt = PromptInput.extend({
  id: z.string().uuid(),
  updated_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
  last_used_at: z.string().datetime({ offset: true }).nullable(),
  use_count: z.number().int().nonnegative(),
});
export const listPromptTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CollectionPageInput.parse(input))
  .handler(async ({ data, context }): Promise<CollectionPage<PromptTemplate>> => {
    return readCollectionPage<PromptTemplate>(
      (signal) => {
        let query = loose(context.supabase)
          .from("prompt_templates")
          .select(
            "id,name,category,body,variables,project_id,context_pack_id,favorite,folder,use_count,last_used_at,created_at,updated_at",
          )
          .eq("user_id", context.userId)
          .order("id", { ascending: true })
          .limit(20)
          .abortSignal(signal);
        if (data.cursor) query = query.gt("id", data.cursor);
        return query;
      },
      "Prompts",
      data.cursor,
      20,
    );
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
const PromptUpdate = z.union([
  z.object({ id: z.string().uuid(), increment_use: z.literal(true) }).strict(),
  z
    .object({
      id: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      favorite: z.boolean().optional(),
      name: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(1).max(12000).optional(),
      variables: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
      folder: z.string().trim().min(1).max(80).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 2, "Prompt changes are required"),
]);
export const updatePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PromptUpdate.parse(input))
  .handler(async ({ data, context }): Promise<PromptTemplate> => {
    const usage = "increment_use" in data;
    const { id, ...rest } = data;
    const changes = usage
      ? {}
      : Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "expectedUpdatedAt"));
    const result = await loose(context.supabase)
      .rpc("mutate_prompt_template", {
        p_prompt_id: id,
        p_expected_updated_at: "expectedUpdatedAt" in data ? data.expectedUpdatedAt : null,
        p_changes: changes,
        p_increment_use: usage,
      })
      .abortSignal(AbortSignal.timeout(15000));
    const saved = SavedPrompt.safeParse(result.data);
    if (result.error || !saved.success || saved.data.id !== id)
      throw new Error("Prompt could not be confirmed. Review saved prompt before retrying.");
    return saved.data;
  });
export const readPromptTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PromptTemplate> => {
    const { data: row, error } = await loose(context.supabase)
      .from("prompt_templates")
      .select(
        "id,name,category,body,variables,project_id,context_pack_id,favorite,folder,use_count,last_used_at,created_at,updated_at",
      )
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single()
      .abortSignal(AbortSignal.timeout(15000));
    if (error || !row) throw new Error("Saved prompt is unavailable.");
    return row as PromptTemplate;
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
  .validator((input: unknown) =>
    z
      .object({
        prompt_id: z.string().uuid(),
        source: z.enum(["versions", "evaluations", "both"]).optional(),
        cursor: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      versions: PromptVersion[];
      evaluations: PromptEvaluation[];
      versionCursor: string | null;
      evaluationCursor: string | null;
    }> => {
      const source = data.source ?? "both",
        cursor = data.cursor ?? null;
      const read = <T extends { id: string }>(table: string, columns: string) =>
        readCollectionPage<T>(
          (signal) => {
            let query = loose(context.supabase)
              .from(table)
              .select(columns)
              .eq("prompt_id", data.prompt_id)
              .eq("user_id", context.userId)
              .order("id", { ascending: true })
              .limit(20)
              .abortSignal(signal);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          "Prompt history",
          cursor,
          20,
        );
      const [versions, evaluations] = await Promise.all([
        source === "evaluations"
          ? { items: [], cursor: null }
          : read<PromptVersion>(
              "prompt_versions",
              "id,prompt_id,version,name,body,variables,created_at",
            ),
        source === "versions"
          ? { items: [], cursor: null }
          : read<PromptEvaluation>("prompt_evaluations", "id,prompt_id,rating,notes,created_at"),
      ]);
      return {
        versions: versions.items,
        evaluations: evaluations.items,
        versionCursor: versions.cursor,
        evaluationCursor: evaluations.cursor,
      };
    },
  );

export const evaluatePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        prompt_id: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        notes: z.string().trim().max(2000),
      })
      .strict()
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PromptEvaluation> => {
    const { data: row, error } = await context.supabase
      .rpc(
        "record_prompt_evaluation" as never,
        {
          p_request_id: data.requestId,
          p_prompt_id: data.prompt_id,
          p_rating: data.rating,
          p_notes: data.notes,
        } as never,
      )
      .abortSignal(AbortSignal.timeout(15_000));
    const parsed = z
      .object({
        id: z.string().uuid(),
        request_id: z.literal(data.requestId),
        prompt_id: z.literal(data.prompt_id),
        rating: z.literal(data.rating),
        notes: z.literal(data.notes),
        created_at: z.string().datetime({ offset: true }),
      })
      .safeParse(row);
    if (error || !parsed.success)
      throw new Error(
        "Evaluation outcome is unconfirmed. Retry with the same saved request identity or review saved evaluations.",
      );
    return parsed.data;
  });
export const deletePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await loose(context.supabase)
      .from("prompt_templates")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("updated_at", data.expectedUpdatedAt)
      .select("id")
      .single()
      .abortSignal(AbortSignal.timeout(15000));
    if (error || !row || row.id !== data.id)
      throw new Error(
        "Prompt changed or deletion could not be confirmed. Review saved prompt before deleting.",
      );
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
  .validator((input: unknown) => CollectionPageInput.parse(input))
  .handler(async ({ data, context }): Promise<CollectionPage<ResearchTemplate>> => {
    return readCollectionPage<ResearchTemplate>(
      (signal) => {
        let query = loose(context.supabase)
          .from("research_templates")
          .select("id,name,steps,allowed_sites,source_preference,created_at,updated_at")
          .eq("user_id", context.userId)
          .order("id", { ascending: true })
          .limit(10)
          .abortSignal(signal);
        if (data.cursor) query = query.gt("id", data.cursor);
        return query;
      },
      "Research templates",
      data.cursor,
      10,
    );
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
export type KnowledgeSource = "projects" | "chats" | "files" | "library" | "memories" | "packs";
const KnowledgeCursors = z
  .object({
    projects: z.string().uuid().nullable(),
    chats: z.string().uuid().nullable(),
    files: z.string().uuid().nullable(),
    library: z.string().uuid().nullable(),
    memories: z.string().uuid().nullable(),
    packs: z.string().uuid().nullable(),
  })
  .partial();
export const listKnowledgeGraph = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ cursors: KnowledgeCursors.optional() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      nodes: KnowledgeNode[];
      edges: KnowledgeEdge[];
      cursors: Record<KnowledgeSource, string | null>;
    }> => {
      const read = async (
        source: KnowledgeSource,
        table: string,
        columns: string,
        owned = false,
        size = 20,
      ) => {
        const cursor = data.cursors?.[source] ?? null;
        const page = await readCollectionPage<{ id: string } & Record<string, unknown>>(
          (signal) => {
            let query = loose(context.supabase)
              .from(table)
              .select(columns)
              .order("id", { ascending: true })
              .limit(size)
              .abortSignal(signal);
            if (owned) query = query.eq("user_id", context.userId);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          "Knowledge graph",
          cursor,
          size,
        );
        return { data: page.items, cursor: page.cursor };
      };
      const [projects, chats, files, library, memories, packs] = await Promise.all([
        read("projects", "projects", "id,name,updated_at"),
        read("chats", "project_chats", "id,project_id,title,updated_at"),
        read("files", "project_files", "id,project_id,name,created_at"),
        read("library", "user_library_items", "id,title,item_type,created_at", true),
        read("memories", "project_memory", "id,project_id,content,created_at"),
        read("packs", "context_packs", "id,name,items,updated_at", true, 1),
      ]);
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
        for (const item of (Array.isArray(row.items) ? row.items : []) as Record<
          string,
          unknown
        >[]) {
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
      return {
        nodes,
        edges: [...relationships.values()],
        cursors: {
          projects: projects.cursor,
          chats: chats.cursor,
          files: files.cursor,
          library: library.cursor,
          memories: memories.cursor,
          packs: packs.cursor,
        },
      };
    },
  );
