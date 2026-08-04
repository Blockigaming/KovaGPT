import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SavedAgent = {
  id: string;
  project_id: string | null;
  name: string;
  instructions: string;
  allowed_tools: string[];
  memory_enabled: boolean;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
export type SavedAgentVersion = Pick<
  SavedAgent,
  "name" | "instructions" | "allowed_tools" | "memory_enabled" | "project_id" | "version"
> & {
  id: string;
  source: "create" | "edit" | "duplicate" | "import" | "restore";
  created_at: string;
};

type Result<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type Query<T = unknown> = {
  select: (columns: string) => Query<T>;
  insert: (value: unknown) => Query<T>;
  update: (value: unknown) => Query<T>;
  delete: () => Query<T>;
  eq: (column: string, value: unknown) => Query<T>;
  order: (column: string, options?: unknown) => Query<T>;
  limit: (count: number) => Query<T> & Result<T>;
  single: () => Result<T>;
  maybeSingle: () => Result<T>;
  then: Result<T>["then"];
};
const table = <T>(client: unknown, name: string) =>
  (client as { from: (tableName: string) => Query<T> }).from(name);

const Id = z.string().uuid();
const Tool = z.enum(["web", "files", "apps"]);
const Fields = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(12_000),
  projectId: Id.nullish(),
  allowedTools: z.array(Tool).max(20).default([]),
  memoryEnabled: z.boolean().default(false),
});
const columns =
  "id,project_id,name,instructions,allowed_tools,memory_enabled,version,archived_at,created_at,updated_at";
const versionColumns =
  "id,project_id,name,instructions,allowed_tools,memory_enabled,version,source,created_at";
const rpc = <T>(client: unknown, name: string, args: unknown) =>
  (client as { rpc: (functionName: string, values: unknown) => Result<T> }).rpc(name, args);

export const listSavedAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedAgent[]> => {
    const { data, error } = await table<SavedAgent[]>(context.supabase, "agent_definitions")
      .select(columns)
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Saved agents could not be loaded.");
    return data ?? [];
  });

export const createSavedAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Fields.parse(input))
  .handler(async ({ data, context }): Promise<SavedAgent> => {
    if (data.projectId) {
      const project = await table(context.supabase, "projects")
        .select("id")
        .eq("id", data.projectId)
        .eq("owner_id", context.userId)
        .maybeSingle();
      if (project.error || !project.data) throw new Error("Project is not available.");
    }
    const { data: row, error } = await table<SavedAgent>(context.supabase, "agent_definitions")
      .insert({
        owner_id: context.userId,
        project_id: data.projectId ?? null,
        name: data.name,
        instructions: data.instructions,
        allowed_tools: [...new Set(data.allowedTools)],
        memory_enabled: data.memoryEnabled,
      })
      .select(columns)
      .single();
    if (error || !row) throw new Error("Agent could not be saved.");
    const version = await table(context.supabase, "agent_definition_versions").insert({
      definition_id: row.id,
      owner_id: context.userId,
      version: 1,
      name: row.name,
      instructions: row.instructions,
      project_id: row.project_id,
      allowed_tools: row.allowed_tools,
      memory_enabled: row.memory_enabled,
      source: "create",
    });
    if (version.error) {
      await table(context.supabase, "agent_definitions")
        .delete()
        .eq("id", row.id)
        .eq("owner_id", context.userId);
      throw new Error("Agent could not be saved.");
    }
    return row;
  });

export const duplicateSavedAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id }).parse(input))
  .handler(async ({ data, context }): Promise<SavedAgent> => {
    const source = await table<SavedAgent>(context.supabase, "agent_definitions")
      .select(columns)
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .single();
    if (source.error || !source.data) throw new Error("Agent could not be duplicated.");
    const created = await table<SavedAgent>(context.supabase, "agent_definitions")
      .insert({
        owner_id: context.userId,
        project_id: source.data.project_id,
        name: `${source.data.name} copy`.slice(0, 120),
        instructions: source.data.instructions,
        allowed_tools: source.data.allowed_tools,
        memory_enabled: source.data.memory_enabled,
      })
      .select(columns)
      .single();
    if (created.error || !created.data) throw new Error("Agent could not be duplicated.");
    const version = await table(context.supabase, "agent_definition_versions").insert({
      definition_id: created.data.id,
      owner_id: context.userId,
      version: 1,
      name: created.data.name,
      instructions: created.data.instructions,
      project_id: created.data.project_id,
      allowed_tools: created.data.allowed_tools,
      memory_enabled: created.data.memory_enabled,
      source: "duplicate",
    });
    if (version.error) {
      await table(context.supabase, "agent_definitions")
        .delete()
        .eq("id", created.data.id)
        .eq("owner_id", context.userId);
      throw new Error("Agent could not be duplicated.");
    }
    return created.data;
  });

export const archiveSavedAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id, archived: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const result = await table(context.supabase, "agent_definitions")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (result.error) throw new Error("Agent archive state could not be changed.");
    return { ok: true as const };
  });

export const listSavedAgentVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id }).parse(input))
  .handler(async ({ data, context }): Promise<SavedAgentVersion[]> => {
    const { data: versions, error } = await table<SavedAgentVersion[]>(
      context.supabase,
      "agent_definition_versions",
    )
      .select(versionColumns)
      .eq("definition_id", data.id)
      .eq("owner_id", context.userId)
      .order("version", { ascending: false })
      .limit(50);
    if (error) throw new Error("Agent history could not be loaded.");
    return versions ?? [];
  });

const Update = Fields.extend({ id: Id, expectedVersion: z.number().int().positive() });
export const updateSavedAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Update.parse(input))
  .handler(async ({ data, context }): Promise<SavedAgent> => {
    const { data: updated, error } = await rpc<SavedAgent>(
      context.supabase,
      "update_agent_definition",
      {
        p_id: data.id,
        p_expected_version: data.expectedVersion,
        p_name: data.name,
        p_instructions: data.instructions,
        p_project_id: data.projectId ?? null,
        p_allowed_tools: [...new Set(data.allowedTools)],
        p_memory_enabled: data.memoryEnabled,
        p_source: "edit",
      },
    );
    if (error || !updated)
      throw new Error(
        error?.message?.includes("agent_version_conflict")
          ? "This agent changed elsewhere. Reload its latest version before saving."
          : "Agent changes could not be saved.",
      );
    return updated;
  });

export const restoreSavedAgentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: Id,
        version: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SavedAgent> => {
    const snapshot = await table<SavedAgentVersion>(context.supabase, "agent_definition_versions")
      .select(versionColumns)
      .eq("definition_id", data.id)
      .eq("owner_id", context.userId)
      .eq("version", data.version)
      .single();
    if (snapshot.error || !snapshot.data) throw new Error("Agent version could not be restored.");
    const restored = await rpc<SavedAgent>(context.supabase, "update_agent_definition", {
      p_id: data.id,
      p_expected_version: data.expectedVersion,
      p_name: snapshot.data.name,
      p_instructions: snapshot.data.instructions,
      p_project_id: snapshot.data.project_id,
      p_allowed_tools: snapshot.data.allowed_tools,
      p_memory_enabled: snapshot.data.memory_enabled,
      p_source: "restore",
    });
    if (restored.error || !restored.data) throw new Error("Agent version could not be restored.");
    return restored.data;
  });

const PortableAgent = z.object({
  format: z.literal("kovagpt-agent"),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(12_000),
  allowedTools: z.array(Tool).max(20),
  memoryEnabled: z.boolean(),
});
export const importSavedAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PortableAgent.parse(input))
  .handler(async ({ data, context }): Promise<SavedAgent> => {
    const created = await table<SavedAgent>(context.supabase, "agent_definitions")
      .insert({
        owner_id: context.userId,
        project_id: null,
        name: data.name,
        instructions: data.instructions,
        allowed_tools: [],
        memory_enabled: false,
      })
      .select(columns)
      .single();
    if (created.error || !created.data) throw new Error("Agent import could not be saved.");
    const snapshot = await table(context.supabase, "agent_definition_versions").insert({
      definition_id: created.data.id,
      owner_id: context.userId,
      version: 1,
      name: created.data.name,
      instructions: created.data.instructions,
      project_id: null,
      allowed_tools: [],
      memory_enabled: false,
      source: "import",
    });
    if (snapshot.error) {
      await table(context.supabase, "agent_definitions")
        .delete()
        .eq("id", created.data.id)
        .eq("owner_id", context.userId);
      throw new Error("Agent import could not be saved.");
    }
    return created.data;
  });
