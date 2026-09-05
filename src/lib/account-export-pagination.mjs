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
  notification_preferences: ["user_id"],
  onboarding_progress: ["user_id"],
  organization_members: ["organization_id", "user_id"],
  project_template_grants: ["template_id", "grantee_user_id"],
  project_template_versions: ["template_id", "version"],
  project_members: ["project_id", "user_id"],
  user_onboarding: ["user_id"],
  user_preferences: ["user_id"],
  user_storage: ["user_id"],
  work_recent_items: ["owner_id", "resource_type", "resource_id"],
  canvas_revisions: ["document_id", "revision"],
});

function failure(code) {
  const error = new Error(code);
  error.name = "AccountExportError";
  return error;
}

/** A deterministic best-effort export, not a cross-table database snapshot. */
export async function readAccountExportRows(makeQuery, table, pageSize, maximumRows) {
  const rows = [];
  for (let offset = 0; offset <= maximumRows; offset += pageSize) {
    let query = makeQuery();
    for (const key of KEYS[table] ?? ["id"]) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data) || data.length > pageSize)
      throw failure("account_export_database_unavailable");
    if (rows.length + data.length > maximumRows) throw failure("account_export_row_limit_exceeded");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
  throw failure("account_export_row_limit_exceeded");
}
