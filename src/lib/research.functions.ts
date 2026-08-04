import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  order: (column: string, options?: unknown) => Query;
  limit: (count: number) => Promise<{ data: unknown[] | null; error: unknown }>;
  update: (value: unknown) => Query;
  delete: () => Query;
};
const table = (client: unknown) =>
  (client as { from: (name: string) => Query }).from("deep_research_runs");
export type ResearchSession = {
  id: string;
  title: string | null;
  query: string;
  status: string;
  report: string | null;
  notes: string | null;
  project_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
export const listResearchSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResearchSession[]> => {
    const { data, error } = await table(context.supabase)
      .select(
        "id,title,query,status,report,notes,project_id,archived_at,created_at,updated_at,completed_at",
      )
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Research history could not be loaded.");
    return (data ?? []) as ResearchSession[];
  });
const Mutation = z.object({ id: z.string().uuid() });
export const renameResearchSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    Mutation.extend({ title: z.string().trim().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await table(context.supabase)
      .update({ title: data.title })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id")
      .limit(1);
    if (result.error) throw new Error("Research session could not be renamed.");
    return { ok: true as const };
  });
export const archiveResearchSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Mutation.extend({ archived: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const result = await table(context.supabase)
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id")
      .limit(1);
    if (result.error) throw new Error("Research archive state could not be changed.");
    return { ok: true as const };
  });
export const deleteResearchSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Mutation.parse(input))
  .handler(async ({ data, context }) => {
    const result = await table(context.supabase)
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id")
      .limit(1);
    if (result.error) throw new Error("Research session could not be deleted.");
    return { ok: true as const };
  });
