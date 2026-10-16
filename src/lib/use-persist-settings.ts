import { useEffect, type RefObject } from "react";
import { toast } from "sonner";
import { settingsKey } from "@/lib/settings-storage";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";
import type { Settings } from "@/lib/settings-types";

/** Persist each committed edit before a route/account change can cancel it. */
export function usePersistSettings({
  settings,
  settingsReady,
  userKey,
  storagePrincipal,
  storagePrincipalRef,
  storageGenerationRef,
}: {
  settings: Settings;
  settingsReady: boolean;
  userKey: string | null;
  storagePrincipal: string;
  storagePrincipalRef: RefObject<string>;
  storageGenerationRef: RefObject<number>;
}) {
  const generation = storageGenerationRef.current;
  useEffect(() => {
    if (
      !settingsReady ||
      typeof window === "undefined" ||
      generation !== storageGenerationRef.current ||
      storagePrincipal !== storagePrincipalRef.current
    )
      return;
    try {
      const storage = safeBrowserStorage("localStorage");
      if (!storage) throw new Error("Storage unavailable");
      storage.setItem(settingsKey(userKey), JSON.stringify(settings));
    } catch {
      toast.error("Settings remain in this view but could not be saved in this browser.");
    }
  }, [
    settings,
    settingsReady,
    userKey,
    generation,
    storagePrincipal,
    storagePrincipalRef,
    storageGenerationRef,
  ]);
}
