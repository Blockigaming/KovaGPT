import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings-types";
import { loadStoredSettings, saveStoredSettings, settingsKey } from "@/lib/settings-storage";
import { applyThemeMode, loadThemeMode } from "@/lib/theme";
import { applyReadingPreferences } from "@/lib/appearance-preferences.mjs";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

export { settingsKey } from "@/lib/settings-storage";

export function loadSettings(
  userKey: string | null,
  { migrateLegacyGuest = false }: { migrateLegacyGuest?: boolean } = {},
): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const stored = loadStoredSettings(userKey, { migrateLegacyGuest });
  return stored
    ? ({ ...DEFAULT_SETTINGS, ...stored } as Settings)
    : { ...DEFAULT_SETTINGS, mode: loadThemeMode() };
}

/**
 * Shared hook to load and persist the user's settings the same way
 * the main chat page does, so the Settings dialog actually saves
 * regardless of which route opened it.
 */
export function useNovaSettings(userKey: string | null, principalResolved: boolean) {
  const principal = principalResolved ? settingsKey(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [state, setState] = useState<{
    principal: string | null;
    generation: number;
    settings: Settings;
    persist: boolean;
  }>({
    principal: null,
    generation: 0,
    settings: DEFAULT_SETTINGS,
    persist: false,
  });
  const settings =
    principal !== null &&
    state.principal === principal &&
    state.generation === generationRef.current
      ? state.settings
      : DEFAULT_SETTINGS;
  const setSettings = useCallback(
    (next: SetStateAction<Settings>) => {
      const generation = generationRef.current;
      setState((previous) => {
        if (
          principal === null ||
          principalRef.current !== principal ||
          generation !== generationRef.current
        )
          return previous;
        const current =
          previous.principal === principal && previous.generation === generation
            ? previous.settings
            : DEFAULT_SETTINGS;
        return {
          principal,
          generation,
          settings: typeof next === "function" ? next(current) : next,
          persist: true,
        };
      });
    },
    [principal],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!principalResolved || principal === null) {
      setState({ principal: null, generation, settings: DEFAULT_SETTINGS, persist: false });
      return;
    }
    const loaded = loadSettings(userKey, { migrateLegacyGuest: userKey === null });
    if (generation !== generationRef.current) return;
    setState({ principal, generation, settings: loaded, persist: false });
    applyThemeMode(loaded.mode ?? "system");
  }, [principal, principalResolved, userKey]);

  // Keep an already-open Settings tab in sync with this account's other tabs.
  useEffect(() => {
    if (!principalResolved || principal === null) return;
    const sync = (event: StorageEvent) => {
      if (
        event.key !== settingsKey(userKey) ||
        event.newValue === null ||
        principalRef.current !== principal
      )
        return;
      const loaded = loadSettings(userKey);
      setState((previous) => {
        if (previous.principal !== principal || previous.generation !== generationRef.current)
          return previous;
        return JSON.stringify(previous.settings) === JSON.stringify(loaded)
          ? previous
          : { ...previous, settings: loaded, persist: false };
      });
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (!principalResolved || principal === null) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setState({ principal: null, generation, settings: DEFAULT_SETTINGS, persist: false });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      principal === null ||
      state.principal !== principal ||
      state.generation !== generationRef.current
    )
      return;
    applyThemeMode(state.settings.mode ?? "dark");
    applyReadingPreferences(document.documentElement, state.settings);
    // Hydration and cross-tab delivery only apply the snapshot. Echoing a
    // passive snapshot can overwrite a newer edit committed by another tab.
    if (!state.persist) return;
    try {
      saveStoredSettings(userKey, state.settings);
      window.dispatchEvent(
        new CustomEvent("kova:settings-saved", { detail: { ownerId: userKey } }),
      );
    } catch {
      toast.error(
        "Preferences could not be saved on this device. Your current choices remain visible; free storage and try again.",
        { duration: Infinity },
      );
    }
  }, [principal, state, userKey]);

  return [settings, setSettings] as const;
}
