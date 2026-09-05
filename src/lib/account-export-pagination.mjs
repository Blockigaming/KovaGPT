// Tables without a single global id must use their complete immutable key.
const KEYS = Object.freeze({
  agent_graph_preferences: ["owner_id", "run_id"],
  app_admin_roles: ["user_id"],
  banned_users: ["user_id"],
  daily_usage: ["user_id", "usage_date"],
  github_repository_branches: ["owner_id", "repository_id", "name"],
  google_connection_preferences: ["user_id"],
  kova_site_files: ["version_id", "path"],
  kova_site_aliases: ["site_id", "slug"],
  kova_site_viewers: ["site_id", "viewer_id"],
  library_file_versions: ["generation"],
  library_file_replacements: ["generation"],
  notification_preferences: ["user_id"],
  onboarding_progress: ["user_id"],
  organization_members: ["organization_id", "user_id"],
  project_template_grants: ["template_id", "grantee_user_id"],
  project_template_versions: ["template_id", "version"],
  project_members: ["project_id", "user_id"],
  scheduled_task_event_source_export_rows: ["grant_id"],
  user_onboarding: ["user_id"],
  user_preferences: ["user_id"],
  user_storage: ["user_id"],
  web_push_preferences: ["user_id"],
  work_recent_items: ["owner_id", "resource_type", "resource_id"],
  work_execution_events: ["run_id", "revision"],
  canvas_revisions: ["document_id", "revision"],
});

function failure(code) {
  const error = new Error(code);
  error.name = "AccountExportError";
  return error;
}

/** One request-local allocation budget shared by every concurrent table reader. */
export function createAccountExportReadBudget(maximumBytes) {
  let used = 0;
  let exceeded = false;
  return {
    assertAvailable() {
      if (exceeded) throw failure("account_export_too_large");
    },
    reserve(rows) {
      this.assertAvailable();
      for (const row of rows) {
        used += new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
        if (used > maximumBytes) {
          exceeded = true;
          throw failure("account_export_too_large");
        }
      }
    },
  };
}

/** A deterministic best-effort export, not a cross-table database snapshot. */
export async function readAccountExportRows(makeQuery, table, pageSize, maximumRows, budget) {
  // Work states and document bodies can be large. A 500-row response defeats
  // the final export cap before JavaScript can account for even its first page.
  if (budget) pageSize = Math.min(pageSize, table === "chat_history_records" ? 1 : 8);
  const rows = [];
  for (let offset = 0; offset <= maximumRows; offset += pageSize) {
    budget?.assertAvailable();
    let query = makeQuery();
    for (const key of KEYS[table] ?? ["id"]) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data) || data.length > pageSize)
      throw failure("account_export_database_unavailable");
    if (rows.length + data.length > maximumRows) throw failure("account_export_row_limit_exceeded");
    budget?.reserve(data);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
  throw failure("account_export_row_limit_exceeded");
}
