export type SettingsStorageUserKey = string | null;

const SETTINGS_KEY_BASE = "nova-gpt-settings-v1";
export const WORKSPACE_DEFAULTS_KEY_BASE = "kova-workspace-defaults-v1";
export const LOCATION_KEY_BASE = "kova-location";
export const LOCATION_STORAGE_CHANGED_EVENT = "kova:location-storage-changed";
export const MEMORY_WRITE_BLOCK_KEY_BASE = "kova-memory-write-block-v1";

export function settingsKey(userKey: SettingsStorageUserKey): string {
  return userKey ? `${SETTINGS_KEY_BASE}:${userKey}` : `${SETTINGS_KEY_BASE}:guest`;
}

function parseSettingsRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function principalStorageKey(baseKey: string, userKey: SettingsStorageUserKey): string {
  const principal = userKey ? `user:${encodeURIComponent(userKey)}` : "guest";
  return `${baseKey}:v2:${principal}`;
}

function loadStoredRecord(
  scopedKey: string,
  legacyKey: string | null,
): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const scopedRaw = localStorage.getItem(scopedKey);
    if (scopedRaw !== null) return parseSettingsRecord(scopedRaw);
    if (legacyKey === null) return null;

    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw === null) return null;
    const legacy = parseSettingsRecord(legacyRaw);
    if (legacy === null) return null;

    try {
      localStorage.setItem(scopedKey, legacyRaw);
      localStorage.removeItem(legacyKey);
    } catch {
      // Preserve the readable legacy guest value when storage is unavailable.
    }
    return legacy;
  } catch {
    return null;
  }
}

/**
 * Read exactly one principal's settings. The ownerless legacy value may only
 * be claimed after authentication has resolved to a guest session.
 */
export function loadStoredSettings(
  userKey: SettingsStorageUserKey,
  { migrateLegacyGuest = false }: { migrateLegacyGuest?: boolean } = {},
): Record<string, unknown> | null {
  return loadStoredRecord(
    settingsKey(userKey),
    userKey === null && migrateLegacyGuest ? SETTINGS_KEY_BASE : null,
  );
}

export function saveStoredSettings(userKey: SettingsStorageUserKey, settings: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(settingsKey(userKey), JSON.stringify(settings));
  if (userKey === null) localStorage.removeItem(SETTINGS_KEY_BASE);
}

/** Best-effort local cleanup for exactly one settings principal. */
export function clearStoredSettings(userKey: SettingsStorageUserKey): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(settingsKey(userKey));
  } catch {
    // Continue so guest legacy cleanup still gets its own attempt.
  }
  if (userKey === null) {
    try {
      localStorage.removeItem(SETTINGS_KEY_BASE);
    } catch {
      // Local cleanup is best effort when browser storage is unavailable.
    }
  }
}

export function loadPrincipalStoredRecord(
  baseKey: string,
  userKey: SettingsStorageUserKey,
  { migrateLegacyGuest = false }: { migrateLegacyGuest?: boolean } = {},
): Record<string, unknown> | null {
  return loadStoredRecord(
    principalStorageKey(baseKey, userKey),
    userKey === null && migrateLegacyGuest ? baseKey : null,
  );
}

export function savePrincipalStoredRecord(
  baseKey: string,
  userKey: SettingsStorageUserKey,
  value: unknown,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(principalStorageKey(baseKey, userKey), JSON.stringify(value));
  if (userKey === null) localStorage.removeItem(baseKey);
}

export function clearPrincipalStoredRecord(baseKey: string, userKey: SettingsStorageUserKey): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(principalStorageKey(baseKey, userKey));
  } catch {
    // Local cleanup is best effort.
  }
  if (userKey === null) {
    try {
      localStorage.removeItem(baseKey);
    } catch {
      // Local cleanup is best effort.
    }
  }
}

/** Clear the current principal's local settings records, not device-wide policies. */
export function clearPrincipalPreferences(userKey: SettingsStorageUserKey): void {
  clearStoredSettings(userKey);
  clearPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, userKey);
  clearPrincipalStoredRecord(LOCATION_KEY_BASE, userKey);
  clearPrincipalStoredRecord(MEMORY_WRITE_BLOCK_KEY_BASE, userKey);
}
