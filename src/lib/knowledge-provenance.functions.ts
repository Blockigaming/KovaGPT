import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
const Type = z.enum(["project", "research", "writing_document", "agent_definition"]),
  Id = z.string().uuid();
const tables = {
  project: ["projects", "owner_id"],
  research: ["deep_research_runs", "user_id"],
  writing_document: ["writing_documents", "owner_id"],
  agent_definition: ["agent_definitions", "owner_id"],
} as const;
type Q = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
  select: (c: string) => Q;
  insert: (v: unknown) => Q;
  update: (v: unknown) => Q;
  eq: (c: string, v: unknown) => Q;
  or: (v: string) => Q;
  order: (c: string, o: unknown) => Q;
  limit: (n: number) => Q;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};
const from = (client: unknown, name: string) => (client as { from: (n: string) => Q }).from(name);
async function owns(client: unknown, type: z.infer<typeof Type>, id: string, userId: string) {
  const [name, owner] = tables[type];
  const row = await from(client, name).select("id").eq("id", id).eq(owner, userId).maybeSingle();
  return Boolean(row.data) && !row.error;
}
export const listKnowledgeRelationships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ type: Type, id: Id }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await owns(context.supabase, data.type, data.id, context.userId)))
      throw new Error("Knowledge source is not available.");
    const result = await from(context.supabase, "knowledge_relationships")
      .select(
        "id,source_type,source_id,target_type,target_id,relationship_type,confidence,derivation_method,evidence_metadata,created_at,updated_at,archived_at,approved_at,rejected_at",
      )
      .eq("owner_id", context.userId)
      .or(
        `and(source_type.eq.${data.type},source_id.eq.${data.id}),and(target_type.eq.${data.type},target_id.eq.${data.id})`,
      )
      .order("updated_at", { ascending: false })
      .limit(100);
    if (result.error) throw new Error("Knowledge relationships could not be loaded.");
    return result.data ?? [];
  });
export const createKnowledgeRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        sourceType: Type,
        sourceId: Id,
        targetType: Type,
        targetId: Id,
        relationshipType: z.string().trim().min(1).max(80),
        confidence: z.number().min(0).max(1),
        derivationMethod: z.enum([
          "user-created",
          "directly-extracted",
          "imported",
          "system-linked",
          "model-suggested",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (
      !(await owns(context.supabase, data.sourceType, data.sourceId, context.userId)) ||
      !(await owns(context.supabase, data.targetType, data.targetId, context.userId))
    )
      throw new Error("Both knowledge records must belong to your account.");
    const pending = data.derivationMethod === "model-suggested";
    const result = await from(context.supabase, "knowledge_relationships").insert({
      owner_id: context.userId,
      source_type: data.sourceType,
      source_id: data.sourceId,
      target_type: data.targetType,
      target_id: data.targetId,
      relationship_type: data.relationshipType,
      confidence: data.confidence,
      derivation_method: data.derivationMethod,
      approved_at: pending ? null : new Date().toISOString(),
    });
    if (result.error) throw new Error("Knowledge relationship could not be created.");
    return { ok: true, pending };
  });
export const decideKnowledgeRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ id: Id, decision: z.enum(["approve", "reject", "archive", "restore"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString(),
      value =
        data.decision === "approve"
          ? { approved_at: now, rejected_at: null }
          : data.decision === "reject"
            ? { rejected_at: now, approved_at: null }
            : data.decision === "archive"
              ? { archived_at: now }
              : { archived_at: null };
    const result = await from(context.supabase, "knowledge_relationships")
      .update({ ...value, updated_at: now })
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data)
      throw new Error("Knowledge relationship could not be updated.");
    return { ok: true };
  });
