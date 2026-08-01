import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@/components/SettingsDialog";
import { loadStoredSettings, saveStoredSettings, settingsKey } from "@/lib/settings-storage";
import { applyThemeMode, loadThemeMode } from "@/lib/theme";

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
  const [state, setState] = useState<{ principal: string | null; settings: Settings }>({
    principal: null,
    settings: DEFAULT_SETTINGS,
  });
  const settings =
    principal !== null && state.principal === principal ? state.settings : DEFAULT_SETTINGS;
  const setSettings = useCallback(
    (next: SetStateAction<Settings>) => {
      setState((previous) => {
        if (principal === null || principalRef.current !== principal) return previous;
        const current = previous.principal === principal ? previous.settings : DEFAULT_SETTINGS;
        return {
          principal,
          settings: typeof next === "function" ? next(current) : next,
        };
      });
    },
    [principal],
  );

  useEffect(() => {
    if (!principalResolved || principal === null) {
      setState({ principal: null, settings: DEFAULT_SETTINGS });
      return;
    }
    const loaded = loadSettings(userKey, { migrateLegacyGuest: userKey === null });
    setState({ principal, settings: loaded });
    applyThemeMode(loaded.mode ?? "system");
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (typeof window === "undefined" || principal === null || state.principal !== principal)
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
