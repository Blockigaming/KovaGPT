export const ACCOUNT_EXPORT_FORMAT = "kovagpt-account-export";
export const ACCOUNT_EXPORT_VERSION = 1;
export const ACCOUNT_EXPORT_MAX_BYTES = 50 * 1024 * 1024;
export const ACCOUNT_EXPORT_PAGE_SIZE = 500;

export const ACCOUNT_EXPORT_DIRECT_TABLES = Object.freeze([
  ["ai_generation_events", "user_id"],
  ["ai_usage_events", "user_id"],
  ["account_audit_entries", "user_id"],
  ["agent_definitions", "owner_id"],
  ["agent_definition_versions", "owner_id"],
  ["agent_approvals", "owner_id"],
  ["agent_deliverables", "owner_id"],
  ["agent_jobs", "owner_id"],
  ["agent_notifications", "owner_id"],
  ["agent_resource_activity", "owner_id"],
  ["agent_resource_audit", "owner_id"],
  ["agent_resource_promotions", "owner_id"],
  ["agent_resource_relationships", "owner_id"],
  ["agent_run_events", "owner_id"],
  ["agent_run_tasks", "owner_id"],
  ["agent_runs", "owner_id"],
  ["agent_specialist_tasks", "owner_id"],
  ["agent_dependency_edges", "owner_id"],
  ["agent_graph_preferences", "owner_id"],
  ["app_admin_roles", "user_id"],
  ["app_notifications", "owner_id"],
  ["banned_users", "user_id"],
  ["chat_branches", "owner_id"],
  ["chat_custom_rules", "owner_id"],
  ["chat_memories", "user_id"],
  ["chat_message_versions", "owner_id"],
  ["chat_pinned_files", "owner_id"],
  ["chat_share_links", "user_id"],
  ["connected_account_audit_log", "user_id"],
  ["connected_accounts", "user_id"],
  ["context_packs", "user_id"],
  ["daily_usage", "user_id"],
  ["deep_research_evidence", "user_id"],
  ["deep_research_runs", "user_id"],
  ["feedback_submissions", "owner_id"],
  ["financial_accounts", "user_id"],
  ["financial_connections", "owner_id"],
  ["github_accounts", "owner_id"],
  ["github_coding_selections", "owner_id"],
  ["github_installations", "owner_id"],
  ["github_repositories", "owner_id"],
  ["github_repository_branches", "owner_id"],
  ["github_sync_records", "owner_id"],
  ["github_tool_audit", "owner_id"],
  ["github_webhooks", "owner_id"],
  ["goal_milestones", "owner_id"],
  ["goals", "owner_id"],
  ["health_connections", "owner_id"],
  ["integration_action_approvals", "owner_id"],
  ["integration_audit_events", "owner_id"],
  ["integration_consents", "owner_id"],
  ["integration_deletion_requests", "owner_id"],
  ["integration_linked_accounts", "owner_id"],
  ["integration_sync_jobs", "owner_id"],
  ["knowledge_relationships", "owner_id"],
  ["library_folders", "user_id"],
  ["notification_deliveries", "user_id"],
  ["notification_preferences", "user_id"],
  ["onboarding_progress", "user_id"],
  ["operational_events", "owner_id"],
  ["pending_tool_actions", "user_id"],
  ["plaid_items", "user_id"],
  ["prompt_evaluations", "user_id"],
  ["prompt_templates", "user_id"],
  ["prompt_versions", "user_id"],
  ["project_template_audit_events", "owner_id"],
  ["project_template_grants", "owner_id"],
  ["project_template_versions", "owner_id"],
  ["project_templates", "owner_id"],
  ["research_templates", "user_id"],
  ["safety_reports", "reporter_id"],
  ["scheduled_task_runs", "user_id"],
  ["scheduled_tasks", "user_id"],
  ["subscriptions", "user_id"],
  ["support_tickets", "owner_id"],
  ["user_library_items", "user_id"],
  ["user_onboarding", "user_id"],
  ["user_preferences", "user_id"],
  ["user_storage", "user_id"],
  ["work_recent_items", "owner_id"],
  ["work_saved_records", "owner_id"],
  ["writing_document_versions", "owner_id"],
  ["writing_documents", "owner_id"],
]);

export const ACCOUNT_EXPORT_PROJECT_TABLES = Object.freeze([
  "project_activity",
  "project_chats",
  "project_comments",
  "project_files",
  "project_invites",
  "project_members",
  "project_memory",
  "project_notes",
  "project_tasks",
]);

const SENSITIVE_KEY =
  /(?:ciphertext|private_notes|state_hash|(?:^|_)(?:access_token|refresh_token|token|token_hash|secret|password|credential|authorization|code_verifier|private_key|service_role_key|client_secret|processor_token|link_token)(?:_|$))/iu;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

export function sanitizeAccountExportValue(value, depth = 0) {
  if (depth > 24) throw new Error("account_export_nesting_exceeded");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAccountExportValue(entry, depth + 1));
  }
  if (!isRecord(value)) return String(value);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = sanitizeAccountExportValue(entry, depth + 1);
  }
  return result;
}

export function accountExportStoragePrefix(userId, jobId) {
  if (!isUuid(userId) || !isUuid(jobId)) throw new Error("account_export_path_invalid");
  return `${userId}/${jobId}`;
}

export function accountExportStoragePath(userId, jobId, artifactId) {
  if (!isUuid(artifactId)) throw new Error("account_export_path_invalid");
  return `${accountExportStoragePrefix(userId, jobId)}/${artifactId}.json`;
}

export function serializeAccountExport(value) {
  const text = `${JSON.stringify(sanitizeAccountExportValue(value), null, 2)}\n`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > ACCOUNT_EXPORT_MAX_BYTES) {
    throw new Error("account_export_too_large");
  }
  return { text, bytes };
}

export function publicAccountExportJob(value, now = new Date()) {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.status !== "string") {
    throw new Error("account_export_job_invalid");
  }
  const expiresAt = typeof value.expires_at === "string" ? value.expires_at : null;
  const downloadable =
    value.status === "complete" &&
    expiresAt !== null &&
    Number.isFinite(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) > now.getTime();
  return {
    id: value.id,
    status: downloadable || value.status !== "complete" ? value.status : "expired",
    requestedAt: typeof value.requested_at === "string" ? value.requested_at : null,
    completedAt: typeof value.completed_at === "string" ? value.completed_at : null,
    expiresAt,
    sizeBytes:
      typeof value.size_bytes === "number" && Number.isSafeInteger(value.size_bytes)
        ? value.size_bytes
        : null,
    failureCode:
      value.status === "failed" && typeof value.failure_code === "string"
        ? value.failure_code
        : null,
    downloadable,
  };
}
