import {
  readCollectionPage,
  CollectionPageInput,
  type CollectionPage,
} from "@/lib/read-bounded-collection";
import { loose } from "@/lib/supabase-loose";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Query = {
  select: (columns?: string) => Query;
  insert: (value: unknown) => Query;
  update: (value: unknown) => Query;
  delete: () => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, value: unknown[]) => Query;
  order: (column: string, options?: unknown) => Query;
  limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
};
const table = (supabase: unknown, name: string) =>
  (supabase as { from: (name: string) => Query }).from(name);

export type RecentItem = {
  id: string;
  type: "project" | "library" | "image" | "task";
  title: string;
  subtitle: string;
  updatedAt: string;
  href: string;
  status?: string;
};
export const listWorkspaceRecents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecentItem[]> => {
    const [projects, projectChats, library, tasks] = await Promise.all([
      table(context.supabase, "projects")
        .select("id,name,description,updated_at")
        .order("updated_at", { ascending: false })
        .limit(30),
      table(context.supabase, "project_chats")
        .select("id,project_id,title,updated_at")
        .order("updated_at", { ascending: false })
        .limit(40),
      table(context.supabase, "user_library_items")
        .select("id,title,item_type,created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(60),
      table(context.supabase, "scheduled_tasks")
        .select("id,title,status,updated_at,last_result")
        .eq("user_id", context.userId)
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);
    const fail = [projects, projectChats, library, tasks].find((result) => result.error);
    if (fail?.error) throw new Error("Recent work could not be loaded");
    return [
      ...((projects.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        type: "project" as const,
        title: String(row.name),
        subtitle: String(row.description ?? "Project"),
        updatedAt: String(row.updated_at),
        href: `/projects/${row.id}`,
      })),
      ...((projectChats.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        type: "project" as const,
        title: String(row.title),
        subtitle: "Project chat",
        updatedAt: String(row.updated_at),
        href: `/projects/${row.project_id}/chat/${row.id}`,
      })),
      ...((library.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        type: row.item_type === "image" ? ("image" as const) : ("library" as const),
        title: String(row.title),
        subtitle: String(row.item_type),
        updatedAt: String(row.created_at),
        href: "/library",
      })),
      ...((tasks.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        type: "task" as const,
        title: String(row.title),
        subtitle: String(row.last_result ?? "Scheduled task"),
        status: String(row.status),
        updatedAt: String(row.updated_at),
        href: "/scheduled-tasks",
      })),
    ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  });

export type MemoryRecord = {
  id: string;
  content: string;
  title: string;
  source: "conversation" | "project";
  category: string;
  projectId?: string;
  updatedAt: string;
};
const MemoryPageInput = z.object({
  cursor: z
    .string()
    .regex(
      /^(conversation|project):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i,
    )
    .nullable()
    .default(null),
});
export const listMemoryCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemoryPageInput.parse(input))
  .handler(async ({ data, context }): Promise<CollectionPage<MemoryRecord>> => {
    const [source, after = ""] = (data.cursor ?? "conversation:").split(":");
    const conversation = source === "conversation";
    const page = await readCollectionPage<{ id: string } & Record<string, unknown>>(
      (signal) => {
        let query = loose(context.supabase)
          .from(conversation ? "chat_memories" : "project_memory")
          .select(conversation ? "id,title,summary,updated_at" : "id,project_id,content,created_at")
          .order("id", { ascending: true })
          .limit(10)
          .abortSignal(signal);
        if (conversation) query = query.eq("user_id", context.userId);
        if (after) query = query.gt("id", after);
        return query;
      },
      "Memories",
      after || null,
      10,
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        content: String(conversation ? row.summary : row.content),
        title: conversation ? String(row.title ?? "Conversation memory") : "Project memory",
        source: conversation ? "conversation" : "project",
        category: conversation ? "Conversation summary" : "Project context",
        ...(conversation ? {} : { projectId: String(row.project_id) }),
        updatedAt: String(conversation ? row.updated_at : row.created_at),
      })),
      cursor: page.cursor ? `${source}:${page.cursor}` : conversation ? "project:" : null,
    };
  });

const MemoryChange = z.object({
  id: z.string().uuid(),
  source: z.enum(["conversation", "project"]),
  content: z.string().trim().min(1).max(2000),
  expectedContent: z.string().max(100000),
});
export const updateMemoryRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemoryChange.parse(input))
  .handler(async ({ data, context }) => {
    const target = data.source === "conversation" ? "chat_memories" : "project_memory";
    const values =
      data.source === "conversation"
        ? { summary: data.content, updated_at: new Date().toISOString() }
        : { content: data.content };
    const { data: row, error } = await table(context.supabase, target)
      .update(values)
      .eq("id", data.id)
      .eq(data.source === "conversation" ? "summary" : "content", data.expectedContent)
      .select(data.source === "conversation" ? "id,summary,updated_at" : "id,content,created_at")
      .single();
    if (error || !row)
      throw new Error("Memory changed or is no longer editable. Review before saving.");
    const saved = row as Record<string, unknown>;
    return {
      ok: true,
      content: String(saved[data.source === "conversation" ? "summary" : "content"]),
      updatedAt: String(saved[data.source === "conversation" ? "updated_at" : "created_at"]),
    };
  });
export const deleteMemoryRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        source: z.enum(["conversation", "project"]),
        expectedContent: z.string().max(100000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await table(
      context.supabase,
      data.source === "conversation" ? "chat_memories" : "project_memory",
    )
      .delete()
      .eq("id", data.id)
      .eq(data.source === "conversation" ? "summary" : "content", data.expectedContent)
      .select("id")
      .single();
    if (error) throw new Error("Memory changed or is no longer deletable. Review before deleting.");
    return { ok: true };
  });

export const mergeMemoryRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        source: z.enum(["conversation", "project"]),
        items: z
          .array(z.object({ id: z.string().uuid(), content: z.string().max(100000) }))
          .min(2)
          .max(30),
      })
      .parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ id: string; content: string; removedIds: string[] }> => {
      const { data: result, error } = await loose(context.supabase).rpc("merge_memory_records", {
        p_source: data.source,
        p_items: data.items,
      });
      if (error || !result)
        throw new Error(
          "Memories changed, exceed the merge limit, or cannot be merged with your access. Review the selection and try again.",
        );
      return result;
    },
  );

const PackItem = z.object({
  type: z.enum([
    "chat",
    "memory",
    "file",
    "library",
    "project",
    "artifact",
    "image",
    "research",
    "prompt",
    "work",
  ]),
  id: z.string().max(120),
  title: z.string().max(200),
  content: z.string().max(12000),
});
const PackInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  items: z.array(PackItem).min(1).max(30),
});
export type ContextPack = z.infer<typeof PackInput> & {
  id: string;
  created_at: string;
  updated_at: string;
};
export const listContextPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CollectionPageInput.parse(input))
  .handler(async ({ data, context }): Promise<CollectionPage<ContextPack>> => {
    return readCollectionPage<ContextPack>(
      (signal) => {
        let query = loose(context.supabase)
          .from("context_packs")
          .select("id,name,description,items,created_at,updated_at")
          .eq("user_id", context.userId)
          .order("id", { ascending: true })
          .limit(1)
          .abortSignal(signal);
        if (data.cursor) query = query.gt("id", data.cursor);
        return query;
      },
      "Context packs",
      data.cursor,
      1,
    );
  });
/** Resolve a prompt's linked pack independently of the currently browsed page. */
export const readContextPack = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ContextPack> => {
    const page = await readCollectionPage<ContextPack>(
      (signal) =>
        loose(context.supabase)
          .from("context_packs")
          .select("id,name,description,items,created_at,updated_at")
          .eq("user_id", context.userId)
          .eq("id", data.id)
          .limit(1)
          .abortSignal(signal),
      "Linked context pack",
      null,
      1,
    );
    if (page.items.length !== 1 || page.items[0].id !== data.id)
      throw new Error(
        "The linked context pack is unavailable. Review the prompt before launching.",
      );
    return page.items[0];
  });
export const createContextPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PackInput.parse(input))
  .handler(async ({ data, context }): Promise<ContextPack> => {
    const { data: row, error } = await table(context.supabase, "context_packs")
      .insert({ ...data, user_id: context.userId })
      .select("id,name,description,items,created_at,updated_at")
      .single();
    if (error || !row) throw new Error("Context pack could not be saved");
    return row as ContextPack;
  });
export const deleteContextPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await table(context.supabase, "context_packs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id")
      .single();
    if (error) throw new Error("Context pack could not be deleted");
    return { ok: true };
  });

export type WorkspaceSignal = {
  id: string;
  kind:
    | "project"
    | "project_chat"
    | "file"
    | "artifact"
    | "image"
    | "memory"
    | "context_pack"
    | "automation"
    | "prompt"
    | "goal";
  title: string;
  subtitle: string;
  href: string;
  updatedAt: string;
  status?: string;
  projectId?: string;
};

/** A single authorized integration feed shared by Home and related-item panels. */
export const listWorkspaceIntelligence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkspaceSignal[]> => {
    const [projects, chats, files, library, memory, packs, tasks, prompts, goals] =
      await Promise.all([
        table(context.supabase, "projects")
          .select("id,name,description,updated_at,pinned_at")
          .order("updated_at", { ascending: false })
          .limit(40),
        table(context.supabase, "project_chats")
          .select("id,project_id,title,updated_at")
          .order("updated_at", { ascending: false })
          .limit(60),
        table(context.supabase, "project_files")
          .select("id,project_id,name,mime_type,created_at")
          .order("created_at", { ascending: false })
          .limit(60),
        table(context.supabase, "user_library_items")
          .select("id,title,item_type,file_type,created_at")
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false })
          .limit(80),
        table(context.supabase, "project_memory")
          .select("id,project_id,content,created_at")
          .order("created_at", { ascending: false })
          .limit(40),
        table(context.supabase, "context_packs")
          .select("id,name,description,updated_at")
          .eq("user_id", context.userId)
          .order("updated_at", { ascending: false })
          .limit(30),

        table(context.supabase, "scheduled_tasks")
          .select("id,title,status,updated_at,next_run_at")
          .eq("user_id", context.userId)
          .order("updated_at", { ascending: false })
          .limit(40),
        table(context.supabase, "prompt_templates")
          .select("id,name,folder,use_count,last_used_at,updated_at")
          .eq("user_id", context.userId)
          .order("updated_at", { ascending: false })
          .limit(40),
        table(context.supabase, "goals")
          .select("id,title,status,priority,progress,target_date,updated_at")
          .eq("owner_id", context.userId)
          .order("updated_at", { ascending: false })
          .limit(40),
      ]);
    const results = [projects, chats, files, library, memory, packs, tasks, prompts, goals];
    if (results.some((result) => result.error))
      throw new Error("Workspace intelligence could not be loaded");
    const signals: WorkspaceSignal[] = [];
    for (const row of (projects.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "project",
        title: String(row.name),
        subtitle: row.pinned_at ? "Pinned Project" : String(row.description ?? "Project"),
        href: `/projects/${row.id}`,
        updatedAt: String(row.updated_at),
        projectId: String(row.id),
      });
    for (const row of (chats.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "project_chat",
        title: String(row.title),
        subtitle: "Project chat",
        href: `/projects/${row.project_id}/chat/${row.id}`,
        updatedAt: String(row.updated_at),
        projectId: String(row.project_id),
      });
    for (const row of (files.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "file",
        title: String(row.name),
        subtitle: String(row.mime_type ?? "Project file"),
        href: `/projects/${row.project_id}`,
        updatedAt: String(row.created_at),
        projectId: String(row.project_id),
      });
    for (const row of (library.data ?? []) as Record<string, unknown>[]) {
      const itemType = String(row.item_type);
      const kind: WorkspaceSignal["kind"] =
        itemType === "image" || String(row.file_type ?? "").startsWith("image/")
          ? "image"
          : ["document", "code", "website_draft", "chat_artifact"].includes(itemType)
            ? "artifact"
            : "file";
      signals.push({
        id: String(row.id),
        kind,
        title: String(row.title),
        subtitle: `Library · ${itemType.replaceAll("_", " ")}`,
        href: "/library",
        updatedAt: String(row.created_at),
      });
    }
    for (const row of (memory.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "memory",
        title: String(row.content).slice(0, 80),
        subtitle: "Project memory",
        href: "/memory",
        updatedAt: String(row.created_at),
        projectId: String(row.project_id),
      });
    for (const row of (packs.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "context_pack",
        title: String(row.name),
        subtitle: String(row.description ?? "Context Pack"),
        href: "/context-packs",
        updatedAt: String(row.updated_at),
      });
    for (const row of (tasks.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "automation",
        title: String(row.title),
        subtitle: row.next_run_at
          ? `Next run ${new Date(String(row.next_run_at)).toLocaleString()}`
          : "Scheduled task",
        href: "/scheduled-tasks",
        updatedAt: String(row.updated_at),
        status: String(row.status),
      });
    for (const row of (prompts.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "prompt",
        title: String(row.name),
        subtitle: `${String(row.folder ?? "Unfiled")} · ${Number(row.use_count ?? 0)} launches`,
        href: "/prompt-studio",
        updatedAt: String(row.last_used_at ?? row.updated_at),
      });
    for (const row of (goals.data ?? []) as Record<string, unknown>[])
      signals.push({
        id: String(row.id),
        kind: "goal",
        title: String(row.title),
        subtitle: `${String(row.priority ?? "medium")} priority · ${Number(row.progress ?? 0)}% complete`,
        href: "/goals",
        updatedAt: String(row.updated_at),
        status: String(row.status),
      });
    return signals.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  });
