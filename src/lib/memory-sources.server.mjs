import { normalizeMemorySourceRefs } from "./memory-sources.mjs";

/** Uses the caller's RLS client only. Current access is checked on every inspection. */
export async function inspectMemorySources(supabase, userId, input) {
  if (input.ownerId !== userId) throw new Error("Memory sources could not be loaded.");
  const refs = normalizeMemorySourceRefs(input.sources);
  if (refs.length > 20) throw new Error("Inspect up to 20 memory sources at a time.");
  const found = new Map();
  for (const kind of ["chat_memory", "project_memory", "conversation_summary"]) {
    const ids = refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
    if (!ids.length) continue;
    const table =
      kind === "chat_memory"
        ? "chat_memories"
        : kind === "project_memory"
          ? "project_memory"
          : "chat_context_summaries";
    const columns =
      kind === "chat_memory"
        ? "id,user_id,title,summary,updated_at"
        : kind === "project_memory"
          ? "id,project_id,content,created_at"
          : "id,user_id,chat_id,completed_summary,completed_at";
    let query = supabase.from(table).select(columns);
    if (kind !== "project_memory") query = query.eq("user_id", userId);
    const { data, error } = await query.in("id", ids).limit(20);
    if (error) throw new Error("Memory sources could not be loaded.");
    for (const row of data ?? []) {
      if (!ids.includes(row.id) || (kind !== "project_memory" && row.user_id !== userId)) continue;
      const ref = refs.find((value) => value.kind === kind && value.id === row.id);
      if (kind === "project_memory" && row.project_id !== ref.projectId) continue;
      const content =
        kind === "chat_memory"
          ? row.summary
          : kind === "project_memory"
            ? row.content
            : row.completed_summary;
      if (typeof content !== "string" || !content.trim()) continue;
      found.set(`${kind}:${row.id}`, {
        ...ref,
        available: true,
        title:
          kind === "chat_memory" && typeof row.title === "string"
            ? row.title.slice(0, 160)
            : kind === "project_memory"
              ? "Project memory"
              : "Earlier conversation summary",
        content: content.slice(0, 6000),
        truncated: content.length > 6000,
        updatedAt:
          kind === "chat_memory"
            ? row.updated_at
            : kind === "project_memory"
              ? row.created_at
              : row.completed_at,
      });
    }
  }
  return refs.map((ref) => found.get(`${ref.kind}:${ref.id}`) ?? { ...ref, available: false });
}
