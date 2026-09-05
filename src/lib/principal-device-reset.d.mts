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
    clearPwaData?: (userKey: string | null) => Promise<void>;
    clearImageHistory?: (userKey: string) => Promise<void>;
    clearChatHistory?: (userKey: string) => Promise<void>;
  },
): Promise<
  PrincipalStorageCleanupResult & {
    imageHistory: { cleared: boolean; failures: string[] };
    chatHistory: { cleared: boolean; failures: string[] };
    pwa: { cleared: boolean; failures: string[] };
  }
>;
