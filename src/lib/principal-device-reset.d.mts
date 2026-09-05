import type {
  BrowserStorageUserKey,
  PrincipalStorageCleanupResult,
  StorageLike,
} from "./principal-browser-storage.mjs";

export function resetPrincipalDeviceData(
  userKey: BrowserStorageUserKey,
  options?: {
    storage?: { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null };
    notify?: (userKey: BrowserStorageUserKey) => unknown;
    clearImageHistory?: (userKey: string) => Promise<void>;
  },
): Promise<
  PrincipalStorageCleanupResult & { imageHistory: { cleared: boolean; failures: string[] } }
>;
