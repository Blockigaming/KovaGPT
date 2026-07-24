import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@/components/SettingsDialog";
import { loadThemeMode } from "@/lib/theme";

const SETTINGS_KEY_BASE = "nova-gpt-settings-v1";

function settingsKey(userKey: string | null) {
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings(userKey));
  }, [userKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(settingsKey(userKey), JSON.stringify(settings));
    } catch {
      /* quota - ignore */
    }
  }, [settings, userKey]);

  return [settings, setSettings] as const;
}
