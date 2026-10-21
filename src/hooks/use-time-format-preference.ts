import { useCallback, useSyncExternalStore } from "react";
import { loadStoredSettings, settingsKey } from "@/lib/settings-storage";
import { timeFormatValue, type TimeFormatPreference } from "@/lib/time-format";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

const serverSnapshot = (): TimeFormatPreference => "system";

/**
 * Read the existing Settings store without a second cache or persistence effect.
 * Unresolved auth never reads guest settings; a new owner gets their own snapshot.
 */
export function useTimeFormatPreference(userKey: string | null, principalResolved: boolean) {
  const getSnapshot = useCallback(
    () => (principalResolved ? timeFormatValue(loadStoredSettings(userKey)?.timeFormat) : "system"),
    [principalResolved, userKey],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!principalResolved || typeof window === "undefined") return () => {};
      const saved = (event: Event) => {
        if ((event as CustomEvent<{ ownerId?: string | null }>).detail?.ownerId === userKey)
          notify();
      };
      const storage = (event: StorageEvent) => {
        if (
          event.storageArea === safeBrowserStorage("localStorage") &&
          (event.key === null || event.key === settingsKey(userKey))
        )
          notify();
      };
      const cleared = (event: Event) => {
        if (isPrincipalBrowserStorageClearedEvent(event, userKey)) notify();
      };
      window.addEventListener("kova:settings-saved", saved);
      window.addEventListener("storage", storage);
      window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
      return () => {
        window.removeEventListener("kova:settings-saved", saved);
        window.removeEventListener("storage", storage);
        window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
      };
    },
    [principalResolved, userKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
