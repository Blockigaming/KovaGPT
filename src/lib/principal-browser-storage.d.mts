export type BrowserStorageUserKey = string | null | undefined;

export type PrincipalHandoffFailureReason =
  | "auth_unresolved"
  | "missing"
  | "malformed"
  | "legacy_unscoped"
  | "unsupported_version"
  | "principal_mismatch"
  | "invalid_timestamp"
  | "expired"
  | "oversized";

export type PrincipalHandoffIOFailureReason =
  | "auth_unresolved"
  | "storage_unavailable"
  | "storage_read_failed"
  | "storage_remove_failed"
  | "storage_write_failed"
  | "payload_unserializable"
  | "oversized";

export type StorageLike = Pick<Storage, "getItem" | "removeItem" | "key" | "length">;
export type HandoffStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;
export type BrowserStorageArea = "localStorage" | "sessionStorage";

export type StorageCleanupArea = {
  available: boolean;
  removed: string[];
  failures: string[];
};

export type PrincipalStorageCleanupResult = {
  resolved: boolean;
  reason: "auth_unresolved" | "invalid_user_key" | null;
  principal: string | null;
  local: StorageCleanupArea;
  session: StorageCleanupArea;
};

export const PRINCIPAL_HANDOFF_VERSION: 1;
export const DEFAULT_HANDOFF_MAX_AGE_MS: number;
export const DEFAULT_HANDOFF_MAX_BYTES: number;
export const PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: string;
export const PRINCIPAL_LOCAL_STORAGE_BASES: readonly string[];
export const PRINCIPAL_SESSION_STORAGE_BASES: readonly string[];
export const DEVICE_PREFERENCE_KEYS: readonly string[];

export function browserStoragePrincipal(userKey: BrowserStorageUserKey): string | null;
export function principalScopedStorageKey(
  baseKey: string,
  userKey: BrowserStorageUserKey,
): string | null;
export function safeBrowserStorage(
  area: BrowserStorageArea,
  target?: Partial<Record<BrowserStorageArea, Storage>> | null,
): Storage | null;
export function createPrincipalHandoffEnvelope<T>(
  userKey: BrowserStorageUserKey,
  payload: T,
  now?: number,
): { version: 1; principal: string; createdAt: number; payload: T } | null;
export function parsePrincipalHandoffEnvelope<T = unknown>(
  raw: unknown,
  userKey: BrowserStorageUserKey,
  options?: { now?: number; maxAgeMs?: number; maxBytes?: number },
): { ok: true; value: T; createdAt: number } | { ok: false; reason: PrincipalHandoffFailureReason };
export function writePrincipalHandoff<T>(
  storage: Pick<HandoffStorageLike, "setItem"> | null,
  baseKey: string,
  userKey: BrowserStorageUserKey,
  payload: T,
  options?: { now?: number; maxBytes?: number },
):
  | { ok: true; key: string; createdAt: number }
  | { ok: false; reason: PrincipalHandoffIOFailureReason };
export function consumePrincipalHandoff<T = unknown>(
  storage: Pick<HandoffStorageLike, "getItem" | "removeItem"> | null,
  baseKey: string,
  userKey: BrowserStorageUserKey,
  options?: { now?: number; maxAgeMs?: number; maxBytes?: number },
):
  | { ok: true; value: T; createdAt: number; key: string }
  | {
      ok: false;
      reason: PrincipalHandoffFailureReason | PrincipalHandoffIOFailureReason;
    };
export function isPrincipalBrowserStorageClearedEvent(
  event: Event | { detail?: { principal?: unknown } } | null,
  userKey: BrowserStorageUserKey,
): boolean;
export function dispatchPrincipalBrowserStorageCleared(
  userKey: BrowserStorageUserKey,
  target?:
    | (EventTarget & {
        CustomEvent?: typeof CustomEvent;
      })
    | null,
): boolean;
export function listPrincipalBrowserStorageKeys(
  userKey: BrowserStorageUserKey,
  options?: { purgeUnscopedPrivate?: boolean },
): {
  principal: string;
  localExact: string[];
  localPrefixes: string[];
  sessionExact: string[];
} | null;
export function clearPrincipalBrowserStorage(
  userKey: BrowserStorageUserKey,
  options?: {
    localStorage?: StorageLike | null;
    sessionStorage?: StorageLike | null;
    purgeUnscopedPrivate?: boolean;
  },
): PrincipalStorageCleanupResult;
export function purgeUnscopedPrivateBrowserStorage(
  userKey: BrowserStorageUserKey,
  options?: {
    localStorage?: StorageLike | null;
    sessionStorage?: StorageLike | null;
  },
): PrincipalStorageCleanupResult;
