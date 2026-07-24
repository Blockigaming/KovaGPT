import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@/components/SettingsDialog";
import { applyThemeMode, loadThemeMode } from "@/lib/theme";

const SETTINGS_KEY_BASE = "nova-gpt-settings-v1";

export function settingsKey(userKey: string | null) {
  return userKey ? `${SETTINGS_KEY_BASE}:${userKey}` : `${SETTINGS_KEY_BASE}:guest`;
}

export function loadSettings(userKey: string | null): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(settingsKey(userKey));
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    const legacy = localStorage.getItem(SETTINGS_KEY_BASE);
    if (legacy) return { ...DEFAULT_SETTINGS, ...JSON.parse(legacy) };
    return { ...DEFAULT_SETTINGS, mode: loadThemeMode() };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Shared hook to load and persist the user's settings the same way
 * the main chat page does, so the Settings dialog actually saves
 * regardless of which route opened it.
 */
export function useNovaSettings(userKey: string | null) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(userKey));
  const hasLoadedSettings = useRef(false);

  useEffect(() => {
    const loaded = loadSettings(userKey);
    hasLoadedSettings.current = true;
    setSettings(loaded);
    applyThemeMode(loaded.mode ?? "system");
  }, [userKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedSettings.current) return;
    applyThemeMode(settings.mode ?? "system");
    try {
      localStorage.setItem(settingsKey(userKey), JSON.stringify(settings));
    } catch {
      /* quota - ignore */
    }
  }, [settings, userKey]);

  return [settings, setSettings] as const;
}
