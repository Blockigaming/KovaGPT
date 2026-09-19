import {
  DEVICE_PREFERENCE_KEYS,
  listPrincipalBrowserStorageKeys,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

/** An estimate of registered account data and shared UI preferences, not browser disk usage. */
export function estimateAccountBrowserBytes(
  userKey: string | null | undefined,
  storage: Storage | null = safeBrowserStorage("localStorage"),
): number | null {
  const plan = listPrincipalBrowserStorageKeys(userKey, { purgeUnscopedPrivate: false });
  if (!plan || !storage) return null;
  const allowed = new Set([...plan.localExact, ...DEVICE_PREFERENCE_KEYS]);
  try {
    const count = storage.length;
    // Do not silently report a truncated estimate as a complete measurement.
    if (!Number.isInteger(count) || count < 0 || count > 10_000) return null;
    let bytes = 0;
    for (let index = 0; index < count; index++) {
      const key = storage.key(index);
      if (!key || (!allowed.has(key) && !plan.localPrefixes.some((p) => key.startsWith(p)))) {
        continue;
      }
      const value = storage.getItem(key);
      if (value !== null) bytes += (key.length + value.length) * 2;
    }
    return bytes;
  } catch {
    return null;
  }
}
