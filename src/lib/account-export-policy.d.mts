export const ACCOUNT_EXPORT_FORMAT: "kovagpt-account-export";
export const ACCOUNT_EXPORT_VERSION: 1;
export const ACCOUNT_EXPORT_MAX_BYTES: number;
export const ACCOUNT_EXPORT_PAGE_SIZE: number;
export const ACCOUNT_EXPORT_RATE_LIMIT: Readonly<{
  action: "account_data_export";
  limit: 2;
  windowSeconds: 3600;
}>;
export const ACCOUNT_EXPORT_COOLDOWN_SECONDS: number;
export const ACCOUNT_EXPORT_DIRECT_TABLES: readonly (readonly [string, string])[];
export const ACCOUNT_EXPORT_PROJECT_TABLES: readonly string[];

export function isUuid(value: unknown): value is string;
export function accountExportCooldownRetryAfter(requestedAt: unknown, now?: number): number;
export function sanitizeAccountExportValue(value: unknown, depth?: number): unknown;
export function accountExportStoragePrefix(userId: string, jobId: string): string;
export function accountExportStoragePath(userId: string, jobId: string, artifactId: string): string;
export function serializeAccountExport(value: unknown): { text: string; bytes: Uint8Array };
export function publicAccountExportJob(
  value: unknown,
  now?: Date,
): {
  id: string;
  status: string;
  requestedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  failureCode: string | null;
  downloadable: boolean;
  cleanupPending: boolean;
};
