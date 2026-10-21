import { principalScopedStorageKey, safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";
import { accountExportJobCooldownRetryAfter, isUuid } from "@/lib/account-export-policy.mjs";

export type AccountExportJob = {
  id: string;
  status: "queued" | "processing" | "complete" | "failed" | "canceled" | "expired";
  requestedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  failureCode: string | null;
  downloadable: boolean;
  cleanupPending: boolean;
};
export type ExportRequestMarker =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "pending"; startedAt: number; previousJobId: string | null };
const MARKER_BASE = "kova-account-export-request";
const timestamp = (value: unknown): string | null =>
  typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : null;

export function parseAccountExportJob(raw: unknown): AccountExportJob | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("invalid_export_status");
  const value = raw as Record<string, unknown>;
  if (
    !isUuid(value.id) ||
    !["queued", "processing", "complete", "failed", "canceled", "expired"].includes(
      String(value.status),
    ) ||
    typeof value.downloadable !== "boolean" ||
    typeof value.cleanupPending !== "boolean"
  )
    throw Error("invalid_export_status");
  const status = value.status as AccountExportJob["status"];
  const expiresAt = timestamp(value.expiresAt);
  return {
    id: value.id,
    status,
    requestedAt: timestamp(value.requestedAt),
    completedAt: timestamp(value.completedAt),
    expiresAt,
    sizeBytes:
      typeof value.sizeBytes === "number" &&
      Number.isSafeInteger(value.sizeBytes) &&
      value.sizeBytes >= 0
        ? value.sizeBytes
        : null,
    failureCode:
      typeof value.failureCode === "string" && /^[a-z_]{1,100}$/u.test(value.failureCode)
        ? value.failureCode
        : null,
    downloadable: status === "complete" && value.downloadable && expiresAt !== null,
    cleanupPending: status === "canceled" && value.cleanupPending,
  };
}

export function exportRequestWaitSeconds(
  job: AccountExportJob | null,
  now = Date.now(),
): number | null {
  if (!job) return 0;
  try {
    return accountExportJobCooldownRetryAfter(job, now);
  } catch {
    return null;
  }
}

export function readExportRequestMarker(owner: string, now = Date.now()): ExportRequestMarker {
  try {
    const area = safeBrowserStorage("sessionStorage");
    const key = principalScopedStorageKey(MARKER_BASE, owner);
    if (!area || !key) return { kind: "unavailable" };
    const raw = area.getItem(key);
    if (raw === null) return { kind: "none" };
    if (raw.length > 200) return { kind: "unavailable" };
    const value = JSON.parse(raw);
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Number.isSafeInteger(value.startedAt) ||
      value.startedAt <= 0 ||
      value.startedAt > now + 1000 ||
      (value.previousJobId !== null && !isUuid(value.previousJobId))
    )
      return { kind: "unavailable" };
    return { kind: "pending", startedAt: value.startedAt, previousJobId: value.previousJobId };
  } catch {
    return { kind: "unavailable" };
  }
}

export function beginExportRequestMarker(
  owner: string,
  previousJobId: string | null,
  now = Date.now(),
): { created: boolean; marker: ExportRequestMarker } {
  const current = readExportRequestMarker(owner, now);
  if (current.kind !== "none") return { created: false, marker: current };
  if (previousJobId !== null && !isUuid(previousJobId))
    return { created: false, marker: { kind: "unavailable" } };
  try {
    const area = safeBrowserStorage("sessionStorage");
    const key = principalScopedStorageKey(MARKER_BASE, owner);
    if (!area || !key) return { created: false, marker: { kind: "unavailable" } };
    area.setItem(key, JSON.stringify({ startedAt: now, previousJobId }));
    const saved = readExportRequestMarker(owner, now);
    const created =
      saved.kind === "pending" && saved.startedAt === now && saved.previousJobId === previousJobId;
    return { created, marker: created ? saved : { kind: "unavailable" } };
  } catch {
    return { created: false, marker: { kind: "unavailable" } };
  }
}

export function clearExportRequestMarker(owner: string): ExportRequestMarker {
  try {
    const area = safeBrowserStorage("sessionStorage");
    const key = principalScopedStorageKey(MARKER_BASE, owner);
    if (!area || !key) return { kind: "unavailable" };
    area.removeItem(key);
    return readExportRequestMarker(owner);
  } catch {
    return { kind: "unavailable" };
  }
}

export function exportStatusLabel(job: AccountExportJob, now = Date.now()) {
  if (job.status === "complete" && job.expiresAt && Date.parse(job.expiresAt) <= now)
    return "Expired";
  return {
    queued: "Requested",
    processing: "Preparing",
    complete: "Ready",
    failed: "Failed",
    canceled: "Canceled",
    expired: "Expired",
  }[job.status];
}

export function exportNeedsPolling(job: AccountExportJob | null, marker: ExportRequestMarker) {
  return (
    marker.kind === "pending" ||
    job?.status === "queued" ||
    job?.status === "processing" ||
    job?.cleanupPending === true
  );
}

export type ExportDownload = { url: string; expiresAt: number; requiresSession: boolean };
export function parseExportDownload(
  value: Record<string, unknown>,
  job: AccountExportJob,
  owner: string,
  appOrigin: string,
  storageBase: string,
  now = Date.now(),
): ExportDownload {
  if (
    !job.downloadable ||
    !job.expiresAt ||
    Date.parse(job.expiresAt) <= now ||
    typeof value.downloadUrl !== "string" ||
    value.downloadUrl.length > 8192
  )
    throw Error("invalid_export_download");
  const url = new URL(value.downloadUrl, appOrigin);
  if (url.username || url.password || url.hash) throw Error("invalid_export_download");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw Error("invalid_export_download");
  if (value.requiresSession === true) {
    const keys = [...url.searchParams.keys()];
    if (
      url.origin !== appOrigin ||
      url.pathname !== "/api/private-files" ||
      keys.length !== 4 ||
      new Set(keys).size !== 4 ||
      !keys.every((key) => ["kind", "owner", "id", "version"].includes(key)) ||
      url.searchParams.get("kind") !== "export" ||
      url.searchParams.get("owner") !== owner ||
      url.searchParams.get("id") !== job.id ||
      !/^[a-f0-9]{64}$/u.test(url.searchParams.get("version") ?? "") ||
      value.downloadExpiresInSeconds !== 0
    )
      throw Error("invalid_export_download");
    return { url: url.href, expiresAt: Date.parse(job.expiresAt), requiresSession: true };
  }
  const base = new URL(storageBase);
  const prefix = `/storage/v1/object/sign/account-exports/${owner}/${job.id}/`;
  const filename = url.pathname.slice(prefix.length);
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(prefix) ||
    !filename.endsWith(".json") ||
    !isUuid(filename.slice(0, -5)) ||
    url.searchParams.size !== 1 ||
    !url.searchParams.get("token") ||
    !Number.isSafeInteger(value.downloadExpiresInSeconds) ||
    Number(value.downloadExpiresInSeconds) < 1 ||
    Number(value.downloadExpiresInSeconds) > 300
  )
    throw Error("invalid_export_download");
  return {
    url: url.href,
    expiresAt: Math.min(
      Date.parse(job.expiresAt),
      now + Number(value.downloadExpiresInSeconds) * 1000,
    ),
    requiresSession: false,
  };
}
