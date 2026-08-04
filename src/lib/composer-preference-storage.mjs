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

export function unscopedLegacyComposerSettingsKey() {
  return LEGACY_SETTINGS_KEY_BASE;
}

function readLegacyValue(raw) {
  if (!raw) return undefined;
  const value = JSON.parse(raw)?.sendOnEnter;
  return typeof value === "boolean" ? value : undefined;
}

export function readPersistedSendOnEnter(storage, scope) {
  try {
    const stored = storage.getItem(composerPreferenceKey(scope));
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
    return DEFAULT_SEND_ON_ENTER;
  }

  let sendOnEnter;
  try {
    const scopedLegacy = storage.getItem(legacyComposerSettingsKey(scope));
    if (scopedLegacy) {
      // A scoped record belongs to this user. Never replace it with the old
      // unscoped value, even when the scoped record omits this preference.
      sendOnEnter = readLegacyValue(scopedLegacy);
      if (sendOnEnter === undefined) return DEFAULT_SEND_ON_ENTER;
    } else {
      sendOnEnter = readLegacyValue(storage.getItem(unscopedLegacyComposerSettingsKey()));
    }
  } catch {
    return DEFAULT_SEND_ON_ENTER;
  }

  if (sendOnEnter === undefined) return DEFAULT_SEND_ON_ENTER;
  try {
    storage.setItem(composerPreferenceKey(scope), sendOnEnter ? "1" : "0");
  } catch {
    // Migration still applies in memory when persistence is unavailable.
  }
  return sendOnEnter;
}
