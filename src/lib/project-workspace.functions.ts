import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type SupabaseQueryLike = {
  from: (table: string) => SupabaseQueryLike;
  select: (columns?: string) => SupabaseQueryLike;
  insert: (values: unknown) => SupabaseQueryLike;
  update: (values: unknown) => SupabaseQueryLike;
  eq: (column: string, value: unknown) => SupabaseQueryLike;
  in: (column: string, values: unknown[]) => SupabaseQueryLike;
  order: (column: string, options?: unknown) => SupabaseQueryLike;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

// ============= Types =============
export type TaskStatus = "todo" | "doing" | "done";
export type ProjectTask = {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type ProjectNote = {
  id: string;
  project_id: string;
  content: string;
  updated_at: string;
  revision: number;
};
export type ProjectFile = {
  id: string;
  project_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  kind: "file" | "image" | "agent-deliverable";
  created_at: string;
  signed_url?: string | null;
};

type ProjectFileStorageRow = ProjectFile & {
  storage_path: string;
};
export type ProjectMemoryItem = {
  id: string;
  project_id: string;
  content: string;
  created_by: string;
  created_at: string;
};
export type ProjectActivity = {
  id: string;
  project_id: string;
  actor_id: string;
  kind: string;
  summary: string;
  created_at: string;
};

async function logActivity(
  supabase: unknown,
  project_id: string,
  actor_id: string,
  kind: string,
  summary: string,
) {
  try {
    await (supabase as SupabaseQueryLike)
      .from("project_activity")
      .insert({ project_id, actor_id, kind, summary });
  } catch {
    /* ignore */
  }
}

// ============= NOTES =============
const noteResult = z.object({
  id: z.string().default(""),
  project_id: z.string().uuid(),
  content: z.string(),
  revision: z.number().int().nonnegative(),
  updated_at: z.string().default(""),
});
async function noteRpc(client: unknown, operation: string, data: Record<string, unknown>) {
  const result = await (
    client as {
      rpc: (
        name: string,
        input: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("collaboration_rpc", { p_operation: operation, p_data: data });
  if (result.error)
    throw new Error("Notes changed or could not be reached. Your draft is preserved.");
  return noteResult.parse(result.data);
}
export const getProjectNote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectNote> =>
    noteRpc(context.supabase, "note_get", { projectId: data.project_id }),
  );
export const saveProjectNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        content: z.string().max(200_000),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const note = await noteRpc(context.supabase, "note_save", {
      projectId: data.project_id,
      content: data.content,
      expectedRevision: data.expectedRevision,
    });
    return { ok: true as const, revision: note.revision };
  });

// ============= TASKS =============
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ project_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ProjectTask[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", data.project_id)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProjectTask[];
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string().trim().min(1).max(500),
        due_date: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectTask> => {
    const { data: max } = await context.supabase
      .from("project_tasks")
      .select("position")
      .eq("project_id", data.project_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pos = (max?.position ?? 0) + 1;
    const { data: row, error } = await context.supabase
      .from("project_tasks")
      .insert({
        project_id: data.project_id,
        title: data.title,
        due_date: data.due_date ?? null,
        position: pos,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(
      context.supabase,
      data.project_id,
      context.userId,
      "task_created",
      `Added task “${data.title}”`,
    );
    return row as ProjectTask;
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(500).optional(),
        status: z.enum(["todo", "doing", "done"]).optional(),
        due_date: z.string().nullable().optional(),
        position: z.number().int().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { id, ...rest } = data;
    const patch: Record<string, unknown> = { ...rest };
    if (rest.status === "done") patch.completed_at = new Date().toISOString();
    if (rest.status && rest.status !== "done") patch.completed_at = null;
    const { data: row, error } = await (context.supabase as unknown as SupabaseQueryLike)
      .from("project_tasks")
      .update(patch)

      .eq("id", id)
      .select("project_id, title")
      .single();
    if (error) throw new Error(error.message);
    const updatedTask = row as { project_id: string; title: string };
    if (rest.status === "done") {
      await logActivity(
        context.supabase,
        updatedTask.project_id,
        context.userId,
        "task_done",
        `Completed task “${updatedTask.title}”`,
      );
    }
    return { ok: true };
  });

export const reorderTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        order: z.array(z.string().uuid()).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // update positions sequentially
    for (let idx = 0; idx < data.order.length; idx++) {
      await context.supabase
        .from("project_tasks")
        .update({ position: idx + 1 })
        .eq("id", data.order[idx])
        .eq("project_id", data.project_id);
    }
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: row } = await context.supabase
      .from("project_tasks")
      .select("project_id, title")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.from("project_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (row)
      await logActivity(
        context.supabase,
        row.project_id,
        context.userId,
        "task_deleted",
        `Removed task “${row.title}”`,
      );
    return { ok: true };
  });

// ============= FILES =============
export const listFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        kind: z.enum(["file", "image", "all"]).default("all"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectFile[]> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { reconcileProjectFileLifecycle } = await import("./project-file-maintenance.server");
      const maintenance = await reconcileProjectFileLifecycle({
        client: supabaseAdmin as unknown as Parameters<
          typeof reconcileProjectFileLifecycle
        >[0]["client"],
        userId: context.userId,
        projectId: data.project_id,
      });
      if (!maintenance.complete) {
        throw new Error("project_file_cleanup_incomplete");
      }
    } catch (error) {
      console.error("[listFiles] lifecycle reconciliation failed");
      throw new Error("Project file cleanup is incomplete. Retry shortly.", { cause: error });
    }

    let q = context.supabase
      .from("project_files")
      .select("id, project_id, name, storage_path, mime_type, size_bytes, kind, created_at")
      .eq("project_id", data.project_id)
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    if (data.kind !== "all") q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const items = (rows ?? []) as ProjectFileStorageRow[];
    return Promise.all(
      items.map(async (item): Promise<ProjectFile> => {
        const base = {
          id: item.id,
          project_id: item.project_id,
          name: item.name,
          mime_type: item.mime_type,
          size_bytes: item.size_bytes,
          kind: item.kind,
          created_at: item.created_at,
        };
        if (item.kind === "agent-deliverable") return { ...base, signed_url: null };
        const { data: signed } = await context.supabase.storage
          .from("project-files")
          .createSignedUrl(item.storage_path, 60);
        return { ...base, signed_url: signed?.signedUrl ?? null };
      }),
    );
  });

export const reindexProjectFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(
    async ({ data, context }): Promise<{ indexed: boolean; chunks: number; reason?: string }> => {
      const { data: row, error } = await context.supabase
        .from("project_files")
        .select("id, project_id, name, storage_path, mime_type, kind, status")
        .eq("id", data.id)
        .maybeSingle();
      if (error || !row) throw new Error("File not found");
      if (row.kind !== "file" || row.status !== "ready") {
        return { indexed: false, chunks: 0, reason: "not_a_ready_document" };
      }
      const { indexProjectFile } = await import("./project-rag.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return indexProjectFile({
        supabaseAdmin: supabaseAdmin as unknown as Parameters<
          typeof indexProjectFile
        >[0]["supabaseAdmin"],
        project_id: row.project_id,
        file_id: row.id,
        storage_path: row.storage_path,
        name: row.name,
        mime_type: row.mime_type ?? null,
      });
    },
  );

// ============= MEMORY =============
export const listMemory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ project_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ProjectMemoryItem[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_memory")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProjectMemoryItem[];
  });

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        content: z.string().trim().min(1).max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectMemoryItem> => {
    const { data: row, error } = await context.supabase
      .from("project_memory")
      .insert({ project_id: data.project_id, content: data.content, created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(
      context.supabase,
      data.project_id,
      context.userId,
      "memory_added",
      "Added a memory",
    );
    return row as ProjectMemoryItem;
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: row } = await context.supabase
      .from("project_memory")
      .select("project_id")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.from("project_memory").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (row)
      await logActivity(
        context.supabase,
        row.project_id,
        context.userId,
        "memory_removed",
        "Removed a memory",
      );
    return { ok: true };
  });

// ============= ACTIVITY =============
export const listActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ project_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ProjectActivity[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_activity")
      .select("id, project_id, actor_id, kind, summary, created_at")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProjectActivity[];
  });

// ============= ARCHIVE =============
export const setProjectArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        archived: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: updated, error } = await context.supabase
      .from("projects")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("The project archive state could not be updated.");
    }
    if (!updated) {
      throw new Error("The project was not found, or you no longer have permission to update it.");
    }
    await logActivity(
      context.supabase,
      data.id,
      context.userId,
      data.archived ? "archived" : "unarchived",
      data.archived ? "Archived project" : "Restored project from archive",
    );
    return { ok: true };
  });

// ============= SEARCH =============
export type SearchResult = {
  kind: "chat" | "note" | "task" | "file" | "memory";
  id: string;
  title: string;
  snippet: string;
};

export const searchProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        q: z.string().trim().min(1).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<SearchResult[]> => {
    const like = `%${data.q.replace(/[%_]/g, "\\$&")}%`;
    const [chats, note, tasks, files, memory] = await Promise.all([
      context.supabase
        .from("project_chats")
        .select("id, title, snapshot")
        .eq("project_id", data.project_id)
        .ilike("title", like)
        .limit(20),
      context.supabase
        .from("project_notes")
        .select("id, content")
        .eq("project_id", data.project_id)
        .maybeSingle(),
      context.supabase
        .from("project_tasks")
        .select("id, title")
        .eq("project_id", data.project_id)
        .ilike("title", like)
        .limit(20),
      context.supabase
        .from("project_files")
        .select("id, name")
        .eq("project_id", data.project_id)
        .eq("status", "ready")
        .ilike("name", like)
        .limit(20),
      context.supabase
        .from("project_memory")
        .select("id, content")
        .eq("project_id", data.project_id)
        .ilike("content", like)
        .limit(20),
    ]);
    const results: SearchResult[] = [];
    for (const c of chats.data ?? [])
      results.push({ kind: "chat", id: c.id, title: c.title, snippet: "Chat" });
    if (
      note.data &&
      String(note.data.content ?? "")
        .toLowerCase()
        .includes(data.q.toLowerCase())
    ) {
      const idx = String(note.data.content).toLowerCase().indexOf(data.q.toLowerCase());
      const snippet = String(note.data.content).slice(Math.max(0, idx - 30), idx + 80);
      results.push({ kind: "note", id: note.data.id, title: "Notes", snippet });
    }
    for (const t of tasks.data ?? [])
      results.push({ kind: "task", id: t.id, title: t.title, snippet: "Task" });
    for (const f of files.data ?? [])
      results.push({ kind: "file", id: f.id, title: f.name, snippet: "File" });
    for (const m of memory.data ?? [])
      results.push({ kind: "memory", id: m.id, title: "Memory", snippet: m.content.slice(0, 120) });
    return results;
  });

// ============= MOVE CHAT INTO / OUT OF PROJECT =============
export const importChatToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.string().max(100_000),
            }),
          )
          .max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("project_chats")
      .insert({
        project_id: data.project_id,
        title: data.title,
        snapshot: { messages: data.messages },
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(
      context.supabase,
      data.project_id,
      context.userId,
      "chat_added",
      `Added chat “${data.title}”`,
    );
    return { id: row.id };
  });

export const moveChatToProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        chat_id: z.string().uuid(),
        project_id: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: row, error } = await context.supabase
      .from("project_chats")
      .update({ project_id: data.project_id })
      .eq("id", data.chat_id)
      .select("title")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(
      context.supabase,
      data.project_id,
      context.userId,
      "chat_moved",
      `Moved chat “${row.title}” here`,
    );
    return { ok: true };
  });
