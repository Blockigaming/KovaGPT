import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

import {
  DEFAULT_SETTINGS,
  SAVED_MEMORY_CONSENT_VERSION,
  type Settings,
} from "@/components/SettingsDialog";
import { loadStoredSettings, saveStoredSettings, settingsKey } from "@/lib/settings-storage";

import { DEFAULT_SETTINGS, type Settings } from "@/components/SettingsDialog";
import {
  CURRENT_MEMORY_CONSENT_VERSION,
  loadStoredSettings,
  saveStoredSettings,
  settingsKey,
} from "@/lib/settings-storage";

import { applyThemeMode, loadThemeMode } from "@/lib/theme";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

export { settingsKey } from "@/lib/settings-storage";

function normalizeLoadedSettings(stored: Record<string, unknown> | null): Settings {
  const loaded = stored
    ? ({ ...DEFAULT_SETTINGS, ...stored } as Settings)
    : { ...DEFAULT_SETTINGS, mode: loadThemeMode() };

  if (loaded.rememberAcross && loaded.memoryConsentVersion !== CURRENT_MEMORY_CONSENT_VERSION) {
    return { ...loaded, rememberAcross: false };
  }

  return loaded;
}

export function loadSettings(
  userKey: string | null,
  { migrateLegacyGuest = false }: { migrateLegacyGuest?: boolean } = {},
): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const stored = loadStoredSettings(userKey, { migrateLegacyGuest });

  if (!stored) return { ...DEFAULT_SETTINGS, mode: loadThemeMode() };

  const loaded = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  if (loaded.rememberAcross && loaded.memoryConsentVersion !== SAVED_MEMORY_CONSENT_VERSION) {
    return {
      ...loaded,
      rememberAcross: false,
      memoryConsentVersion: undefined,
    };
  }
  return loaded;

  return normalizeLoadedSettings(stored);

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
  }>({
    principal: null,
    generation: 0,
    settings: DEFAULT_SETTINGS,
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
        };
      });
    },
    [principal],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!principalResolved || principal === null) {
      setState({ principal: null, generation, settings: DEFAULT_SETTINGS });
      return;
    }
    const loaded = loadSettings(userKey, { migrateLegacyGuest: userKey === null });
    if (generation !== generationRef.current) return;
    setState({ principal, generation, settings: loaded });
    applyThemeMode(loaded.mode ?? "system");
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (!principalResolved || principal === null) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setState({ principal: null, generation, settings: DEFAULT_SETTINGS });
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
    applyThemeMode(state.settings.mode ?? "system");
    try {
      saveStoredSettings(userKey, state.settings);
    } catch {
      /* quota - ignore */
    }
  }, [principal, state, userKey]);

  return [settings, setSettings] as const;
}
