import { createHash } from "node:crypto";

// Only counts leave Postgres. No chat IDs, user IDs, content, messages, row
// samples, array values or application RPC results are projected. This is a
// point-in-time compatibility check; it cannot establish catalog equivalence.
export const DAY15_CHAT_DATA_SQL = `begin transaction isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local search_path = pg_catalog;
with branch_counts as (
  select count(*) filter (where b.chat_id is null or char_length(b.chat_id) not between 1 and 256)::integer as bad_chat_id,
    count(*) filter (where b.conversation_id is null or char_length(b.conversation_id) not between 1 and 256)::integer as bad_conversation_id,
    count(*) filter (where b.branch_from_message_index < 0)::integer as negative_message_index,
    count(*) filter (where coalesce(array_length(b.message_ids, 1), 0) > 2000)::integer as oversized_message_id_array,
    count(*) filter (where b.parent_branch_id = b.id)::integer as self_parent,
    count(*) filter (where b.parent_branch_id is not null
      and (parent.id is null or parent.owner_id is distinct from b.owner_id
        or parent.chat_id is distinct from b.chat_id))::integer as wrong_parent_scope
  from public.chat_branches b
  left join public.chat_branches parent on parent.id = b.parent_branch_id
), branch_duplicates as (
  select count(*)::integer as multiple_active
  from (
    select 1 from public.chat_branches where active
    group by owner_id, chat_id having count(*) > 1
  ) duplicated
), rule_counts as (
  select count(*) filter (where chat_id is null or char_length(chat_id) not between 1 and 256)::integer as bad_chat_id,
    count(*) filter (where instructions is null or char_length(instructions) > 8000)::integer as bad_instruction,
    count(*) filter (where owner_id is null)::integer as missing_owner
  from public.chat_custom_rules
), version_counts as (
  select count(*) filter (where v.chat_id is null or char_length(v.chat_id) not between 1 and 256)::integer as bad_chat_id,
    count(*) filter (where v.message_id is null or char_length(v.message_id) not between 1 and 256)::integer as bad_message_id,
    count(*) filter (where v.source not in ('original','inline_edit','retry','branch_edit') or v.source is null)::integer as bad_source,
    count(*) filter (where v.source = 'regeneration')::integer as retired_regeneration,
    count(*) filter (where v.instruction is not null and char_length(v.instruction) > 4000)::integer as oversized_instruction,
    count(*) filter (where v.content is null or char_length(v.content) > 131072
      or (v.original_content is not null and char_length(v.original_content) > 131072))::integer as oversized_or_missing_content,
    count(*) filter (where (v.selection_start is null) <> (v.selection_end is null)
      or (v.selection_start is not null and (v.selection_start < 0 or v.selection_end <= v.selection_start)))::integer as bad_selection_pair,
    count(*) filter (where v.branch_id is not null
      and (b.id is null or b.owner_id is distinct from v.owner_id
        or b.chat_id is distinct from v.chat_id))::integer as wrong_branch_scope
  from public.chat_message_versions v
  left join public.chat_branches b on b.id = v.branch_id
), version_duplicates as (
  select count(*)::integer as multiple_accepted
  from (
    select 1 from public.chat_message_versions where accepted
    group by owner_id, chat_id, message_id having count(*) > 1
  ) duplicated
), pin_counts as (
  select count(*) filter (where chat_id is null or char_length(chat_id) not between 1 and 256)::integer as bad_chat_id,
    count(*) filter (where status not in ('active','indexing','failed','permission_lost','deleted') or status is null)::integer as bad_status,
    count(*) filter (where status = 'ready')::integer as retired_ready,
    count(*) filter (where (source_type = 'library' and project_id is not null)
      or (source_type = 'project_file' and project_id is null)
      or source_type not in ('library','project_file') or source_type is null)::integer as bad_source_project,
    count(*) filter (where owner_id is null)::integer as missing_owner
  from public.chat_pinned_files
)
select jsonb_build_object(
  'chat_branches', to_jsonb(branch_counts) || to_jsonb(branch_duplicates),
  'chat_custom_rules', to_jsonb(rule_counts),
  'chat_message_versions', to_jsonb(version_counts) || to_jsonb(version_duplicates),
  'chat_pinned_files', to_jsonb(pin_counts)
) as violation_counts
from branch_counts, branch_duplicates, rule_counts, version_counts, version_duplicates, pin_counts;
commit;`;

export const DAY15_CHAT_DATA_QUERY_SHA256 = createHash("sha256")
  .update(DAY15_CHAT_DATA_SQL)
  .digest("hex");

const REQUIRED = {
  chat_branches: [
    "bad_chat_id",
    "bad_conversation_id",
    "negative_message_index",
    "oversized_message_id_array",
    "self_parent",
    "wrong_parent_scope",
    "multiple_active",
  ],
  chat_custom_rules: ["bad_chat_id", "bad_instruction", "missing_owner"],
  chat_message_versions: [
    "bad_chat_id",
    "bad_message_id",
    "bad_source",
    "retired_regeneration",
    "oversized_instruction",
    "oversized_or_missing_content",
    "bad_selection_pair",
    "wrong_branch_scope",
    "multiple_accepted",
  ],
  chat_pinned_files: [
    "bad_chat_id",
    "bad_status",
    "retired_ready",
    "bad_source_project",
    "missing_owner",
  ],
};

export function validateDay15ChatDataViolations(counts) {
  const validObject = (value, keys) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
  if (!validObject(counts, Object.keys(REQUIRED))) throw new Error("day15_chat_data_shape_invalid");
  const result = {};
  for (const [table, keys] of Object.entries(REQUIRED)) {
    if (!validObject(counts[table], keys)) throw new Error("day15_chat_data_shape_invalid");
    result[table] = {};
    for (const key of keys) {
      const value = counts[table][key];
      if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
        throw new Error("day15_chat_data_count_invalid");
      result[table][key] = value;
    }
  }
  return {
    querySha256: DAY15_CHAT_DATA_QUERY_SHA256,
    counts: result,
    observedViolationCount: Object.values(result)
      .flatMap(Object.values)
      .reduce((a, b) => a + b, 0),
    schemaProofPromoted: false,
    productionReleaseReady: false,
    limitation:
      "Snapshot counts cover only listed predicates in four tables. Zero rows make conversion checks vacuous; source/live catalogs, full routines, UTF-16 bounds, later writers, executable RLS and synthetic concurrency are separate.",
  };
}
