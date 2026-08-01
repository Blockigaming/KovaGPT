export const DEFAULT_SEND_ON_ENTER = true;

const PREFERENCE_KEY_BASE = "kova-composer-send-on-enter-v1";
const LEGACY_SETTINGS_KEY_BASE = "nova-gpt-settings-v1";

export function scopeForComposerPreference(userKey) {
  return userKey || "guest";
}

export function composerPreferenceKey(scope) {
  return `${PREFERENCE_KEY_BASE}:${scope}`;
}

export function legacyComposerSettingsKey(scope) {
  return `${LEGACY_SETTINGS_KEY_BASE}:${scope}`;
}

export function readPersistedSendOnEnter(storage, scope) {
  try {
    const stored = storage.getItem(composerPreferenceKey(scope));
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
    return DEFAULT_SEND_ON_ENTER;
  }

  try {
    const legacy = storage.getItem(legacyComposerSettingsKey(scope));
    if (!legacy) return DEFAULT_SEND_ON_ENTER;
    const sendOnEnter = JSON.parse(legacy)?.sendOnEnter;
    if (typeof sendOnEnter !== "boolean") return DEFAULT_SEND_ON_ENTER;
    try {
      storage.setItem(composerPreferenceKey(scope), sendOnEnter ? "1" : "0");
    } catch {
      // Migration still applies in memory when persistence is unavailable.
    }
    return sendOnEnter;
  } catch {
    return DEFAULT_SEND_ON_ENTER;
  }
}
