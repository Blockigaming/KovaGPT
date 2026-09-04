import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ACCOUNT_EXPORT_DIRECT_TABLES,
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_PAGE_SIZE,
  ACCOUNT_EXPORT_PROJECT_TABLES,
  ACCOUNT_EXPORT_VERSION,
  accountExportStoragePrefix,
  accountExportStoragePath,
  sanitizeAccountExportValue,
  serializeAccountExport,
} from "@/lib/account-export-policy.mjs";

const EXPORT_BUCKET = "account-exports";
const MAX_ROWS = 100_000;
const MAX_EMBEDDED_FILE_BYTES = 32 * 1024 * 1024;

type ExportRow = Record<string, unknown>;
type QueryError = { message: string; code?: string | null };
type QueryResult = { data: ExportRow[] | null; error: QueryError | null };
type SingleResult = { data: ExportRow | null; error: QueryError | null };
type ExportQuery = {
  select(columns?: string): ExportQuery;
  eq(column: string, value: unknown): ExportQuery;
  in(column: string, values: unknown[]): ExportQuery;
  lt(column: string, value: unknown): ExportQuery;
  order(column: string, options?: { ascending?: boolean }): ExportQuery;
  limit(value: number): ExportQuery;
  range(from: number, to: number): PromiseLike<QueryResult>;
  maybeSingle(): PromiseLike<SingleResult>;
  insert(value: unknown): ExportQuery;
  update(value: unknown): ExportQuery;
};
type RpcResult = { data: unknown; error: QueryError | null };
type StorageResult = { error: QueryError | null };
type DownloadResult = { data: Blob | null; error: QueryError | null };
type ListResult = { data: Array<{ name: string }> | null; error: QueryError | null };
type ExportAdmin = {
  from(table: string): ExportQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult>;
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: unknown | null };
        error: QueryError | null;
      }>;
    };
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Promise<StorageResult>;
      download(path: string): Promise<DownloadResult>;
      list(path: string, options: { limit: number; offset: number }): Promise<ListResult>;
      remove(paths: string[]): Promise<StorageResult>;
    };
  };
};

const admin = supabaseAdmin as unknown as ExportAdmin;

export type ClaimedAccountExport = {
  id: string;
  user_id: string;
  attempts: number;
  status: "processing";
};

function exportError(code: string): Error {
  const error = new Error(code);
  error.name = "AccountExportError";
  return error;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]{3,80}$/u.test(error.message)) return error.message;
  return "account_export_failed";
}

export async function clearAccountExportArtifacts(userId: string, jobId: string): Promise<void> {
  const prefix = accountExportStoragePrefix(userId, jobId);
  const listed = await admin.storage.from(EXPORT_BUCKET).list(prefix, { limit: 100, offset: 0 });
  if (listed.error || !listed.data) throw exportError("account_export_storage_unavailable");
  if (listed.data.length >= 100) throw exportError("account_export_artifact_limit_exceeded");
  const paths = listed.data.map((entry) => {
    if (!/^[0-9a-f-]{36}\.json$/iu.test(entry.name) || entry.name.includes("/")) {
      throw exportError("account_export_artifact_name_invalid");
    }
    return `${prefix}/${entry.name}`;
  });
  if (paths.length === 0) return;
  const removed = await admin.storage.from(EXPORT_BUCKET).remove(paths);
  if (removed.error) throw exportError("account_export_storage_unavailable");
}

async function readAllWhere(table: string, column: string, value: unknown): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += ACCOUNT_EXPORT_PAGE_SIZE) {
    const result = await admin
      .from(table)
      .select("*")
      .eq(column, value)
      .range(offset, offset + ACCOUNT_EXPORT_PAGE_SIZE - 1);
    if (result.error) throw exportError("account_export_database_unavailable");
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < ACCOUNT_EXPORT_PAGE_SIZE) return rows;
  }
  throw exportError("account_export_row_limit_exceeded");
}

async function readAllIn(table: string, column: string, values: unknown[]): Promise<ExportRow[]> {
  if (values.length === 0) return [];
  const rows: ExportRow[] = [];
  for (let batchStart = 0; batchStart < values.length; batchStart += 100) {
    const batch = values.slice(batchStart, batchStart + 100);
    for (let offset = 0; offset < MAX_ROWS; offset += ACCOUNT_EXPORT_PAGE_SIZE) {
      const result = await admin
        .from(table)
        .select("*")
        .in(column, batch)
        .range(offset, offset + ACCOUNT_EXPORT_PAGE_SIZE - 1);
      if (result.error) throw exportError("account_export_database_unavailable");
      const page = result.data ?? [];
      rows.push(...page);
      if (rows.length > MAX_ROWS) throw exportError("account_export_row_limit_exceeded");
      if (page.length < ACCOUNT_EXPORT_PAGE_SIZE) break;
    }
  }
  return rows;
}

function ids(rows: ExportRow[], key = "id"): string[] {
  return rows.flatMap((row) => (typeof row[key] === "string" ? [row[key]] : []));
}

function uniqueRows(rows: ExportRow[]): ExportRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = typeof row.id === "string" ? row.id : JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectDirectRecords(userId: string): Promise<Record<string, ExportRow[]>> {
  const records: Record<string, ExportRow[]> = {};
  for (let offset = 0; offset < ACCOUNT_EXPORT_DIRECT_TABLES.length; offset += 8) {
    const batch = ACCOUNT_EXPORT_DIRECT_TABLES.slice(offset, offset + 8);
    const results = await Promise.all(
      batch.map(async ([table, ownerColumn]) => ({
        table,
        rows: await readAllWhere(table, ownerColumn, userId),
      })),
    );
    for (const result of results) records[result.table] = result.rows;
  }
  return records;
}

async function collectProjectRecords(userId: string): Promise<Record<string, ExportRow[]>> {
  const ownedProjects = await readAllWhere("projects", "owner_id", userId);
  const memberships = await readAllWhere("project_members", "user_id", userId);
  const authoredComments = await readAllWhere("project_comments", "author_id", userId);
  const projectIds = ids(ownedProjects);
  const result: Record<string, ExportRow[]> = {
    projects: ownedProjects,
    project_memberships: memberships,
    project_comments_authored: authoredComments,
  };
  await Promise.all(
    ACCOUNT_EXPORT_PROJECT_TABLES.map(async (table) => {
      result[table] = await readAllIn(table, "project_id", projectIds);
    }),
  );
  const fileIds = ids(result.project_files ?? []);
  result.project_file_chunks = await readAllIn("project_file_chunks", "file_id", fileIds);
  return result;
}

async function collectFamilyRecords(userId: string): Promise<Record<string, ExportRow[]>> {
  const owned = await readAllWhere("family_groups", "owner_id", userId);
  const memberships = await readAllWhere("family_members", "user_id", userId);
  const ownedGroupIds = ids(owned);
  return {
    family_groups: owned,
    family_memberships: memberships,
    family_members: await readAllIn("family_members", "group_id", ownedGroupIds),
    family_invites: await readAllIn("family_invites", "group_id", ownedGroupIds),
  };
}

async function collectRelatedRecords(
  userId: string,
  direct: Record<string, ExportRow[]>,
): Promise<Record<string, ExportRow[]>> {
  const ownedShares = await readAllWhere("shared_chats", "owner_user_id", userId);
  const receivedShares = await readAllWhere("shared_chats", "recipient_user_id", userId);
  const receivedTemplateGrants = await readAllWhere(
    "project_template_grants",
    "grantee_user_id",
    userId,
  );
  const jobIds = ids(direct.agent_jobs ?? []);
  const linkedAccountIds = ids(direct.integration_linked_accounts ?? []);
  return {
    shared_chats: uniqueRows([...ownedShares, ...receivedShares]),
    project_template_grants: uniqueRows([
      ...(direct.project_template_grants ?? []),
      ...receivedTemplateGrants,
    ]),
    agent_job_events: await readAllIn("agent_job_events", "job_id", jobIds),
    integration_webhook_subscriptions: await readAllIn(
      "integration_webhook_subscriptions",
      "linked_account_id",
      linkedAccountIds,
    ),
  };
}

type EmbeddedFile = {
  bucket: string;
  path: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
  base64: string;
};

async function embedFile(
  bucket: string,
  path: string,
  contentType: string | null,
  remaining: number,
): Promise<EmbeddedFile> {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("..")) {
    throw exportError("account_export_file_path_invalid");
  }
  const downloaded = await admin.storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) throw exportError("account_export_file_unavailable");
  if (downloaded.data.size > remaining) throw exportError("account_export_too_large");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  return {
    bucket,
    path,
    contentType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: Buffer.from(bytes).toString("base64"),
  };
}

async function collectFiles(records: Record<string, ExportRow[]>): Promise<EmbeddedFile[]> {
  const candidates = new Map<string, { bucket: string; path: string; type: string | null }>();
  for (const row of records.project_files ?? []) {
    // Keep every metadata row in the export, including recoverable failures,
    // but embed bytes only for objects the file lifecycle has published.
    if (
      row.status === "ready" &&
      (row.kind === "file" || row.kind === "image") &&
      typeof row.storage_path === "string"
    ) {
      candidates.set(`project-files:${row.storage_path}`, {
        bucket: "project-files",
        path: row.storage_path,
        type: typeof row.mime_type === "string" ? row.mime_type : null,
      });
    }
  }
  for (const row of records.user_library_items ?? []) {
    if (typeof row.file_url === "string" && row.file_url && !/^https?:/iu.test(row.file_url)) {
      candidates.set(`library-images:${row.file_url}`, {
        bucket: "library-images",
        path: row.file_url,
        type: typeof row.file_type === "string" ? row.file_type : null,
      });
    }
  }

  const embedded: EmbeddedFile[] = [];
  let total = 0;
  for (const candidate of candidates.values()) {
    const file = await embedFile(
      candidate.bucket,
      candidate.path,
      candidate.type,
      MAX_EMBEDDED_FILE_BYTES - total,
    );
    embedded.push(file);
    total += file.sizeBytes;
  }
  return embedded;
}

export async function buildAccountExport(userId: string, jobId: string) {
  const authResult = await admin.auth.admin.getUserById(userId);
  if (authResult.error || !authResult.data.user)
    throw exportError("account_export_user_unavailable");

  const direct = await collectDirectRecords(userId);
  const [project, family, related] = await Promise.all([
    collectProjectRecords(userId),
    collectFamilyRecords(userId),
    collectRelatedRecords(userId, direct),
  ]);
  const records = { ...direct, ...project, ...family, ...related };
  const files = await collectFiles(records);
  const generatedAt = new Date().toISOString();
  return serializeAccountExport({
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    exportId: jobId,
    generatedAt,
    account: authResult.data.user,
    records,
    files,
    notes: [
      "OAuth credentials, access tokens, refresh tokens, secrets, and private moderation notes are intentionally excluded.",
      "The export reflects records available while the job ran; changes made during processing can appear in a later export.",
    ],
  });
}

async function processClaimed(job: ClaimedAccountExport, workerId: string) {
  let uploadedPath: string | null = null;
  try {
    const artifact = await buildAccountExport(job.user_id, job.id);
    await clearAccountExportArtifacts(job.user_id, job.id);
    const path = accountExportStoragePath(job.user_id, job.id, randomUUID());
    const upload = await admin.storage.from(EXPORT_BUCKET).upload(path, artifact.bytes, {
      contentType: "application/json",
      upsert: false,
    });
    if (upload.error) throw exportError("account_export_storage_unavailable");
    uploadedPath = path;

    const settled = await admin.rpc("settle_account_export_success", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_storage_path: path,
      p_content_sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
      p_size_bytes: artifact.bytes.byteLength,
    });
    if (settled.error || settled.data !== true) {
      await admin.storage.from(EXPORT_BUCKET).remove([path]);
      throw exportError("account_export_settlement_failed");
    }
    return { id: job.id, status: "complete" as const };
  } catch (error) {
    if (uploadedPath) await admin.storage.from(EXPORT_BUCKET).remove([uploadedPath]);
    const code = errorCode(error);
    const retryable = new Set([
      "account_export_database_unavailable",
      "account_export_storage_unavailable",
      "account_export_file_unavailable",
      "account_export_settlement_failed",
    ]).has(code);
    const settled = await admin.rpc("settle_account_export_failure", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_failure_code: code,
      p_retryable: retryable,
    });
    if (settled.error || (settled.data !== "queued" && settled.data !== "failed")) {
      throw exportError("account_export_failure_settlement_failed");
    }
    return {
      id: job.id,
      status: settled.data === "queued" ? ("retry" as const) : ("failed" as const),
    };
  }
}

export async function cleanupExpiredAccountExports(limit = 20): Promise<number> {
  const result = await admin
    .from("account_export_jobs")
    .select("id, user_id")
    .eq("status", "complete")
    .lt("expires_at", new Date().toISOString())
    .limit(Math.max(1, Math.min(limit, 50)))
    .range(0, Math.max(1, Math.min(limit, 50)) - 1);
  if (result.error) throw exportError("account_export_cleanup_unavailable");
  let cleaned = 0;
  for (const row of result.data ?? []) {
    if (typeof row.id !== "string" || typeof row.user_id !== "string") continue;
    try {
      await clearAccountExportArtifacts(row.user_id, row.id);
    } catch {
      continue;
    }
    const update = await admin
      .from("account_export_jobs")
      .update({ status: "expired", storage_path: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "complete")
      .select("id")
      .maybeSingle();
    if (!update.error) cleaned += 1;
  }
  return cleaned;
}

export async function runAccountExportBatch(options?: { workerId?: string; limit?: number }) {
  const workerId = options?.workerId ?? `account-export-${randomUUID()}`;
  const limit = Math.max(1, Math.min(options?.limit ?? 2, 5));
  await cleanupExpiredAccountExports();
  const claimed = await admin.rpc("claim_account_export_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 180,
  });
  if (claimed.error || !Array.isArray(claimed.data)) {
    throw exportError("account_export_claim_failed");
  }
  const jobs = (claimed.data as unknown[]).map((value) => {
    const row = sanitizeAccountExportValue(value) as ClaimedAccountExport;
    if (!row || typeof row.id !== "string" || typeof row.user_id !== "string") {
      throw exportError("account_export_claim_invalid");
    }
    return row;
  });
  const results = [];
  for (const job of jobs) results.push(await processClaimed(job, workerId));
  return {
    claimed: jobs.length,
    complete: results.filter((entry) => entry.status === "complete").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    retry: results.filter((entry) => entry.status === "retry").length,
    results,
  };
}
