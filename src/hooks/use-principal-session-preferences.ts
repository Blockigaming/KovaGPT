import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
  type BrowserStorageUserKey,
} from "@/lib/principal-browser-storage.mjs";

/** Pass a stable parser which returns defaults for null and only allowlisted, bounded fields. */
export function usePrincipalSessionPreferences<T extends object>(
  baseKey: string,
  userKey: BrowserStorageUserKey,
  parse: (raw: string | null) => T,
): readonly [T, (patch: Partial<T>) => void] {
  const key = principalScopedStorageKey(baseKey, userKey);
  const defaults = useMemo(() => parse(null), [parse]);
  const [snapshot, setSnapshot] = useState<{ key: string | null; value: T }>({
    key: null,
    value: defaults,
  });
  const currentKey = useRef(key);
  currentKey.current = key;
  const activeScope = useRef<{ key: string | null; value: T } | null>(null);

  useEffect(() => {
    let value = defaults;
    // Unresolved auth does not read guest storage. Hydration never writes, so a loading
    // render (or Strict Mode's repeated setup) cannot erase a saved selection.
    if (key) {
      try {
        value = parse(safeBrowserStorage("sessionStorage")?.getItem(key) ?? null);
      } catch {
        /* Optional preference storage may be unavailable. */
      }
    }
    const scope = { key, value };
    activeScope.current = scope;
    setSnapshot({ key, value });

    const reset = (event: Event) => {
      if (
        !key ||
        currentKey.current !== key ||
        activeScope.current !== scope ||
        !isPrincipalBrowserStorageClearedEvent(event, userKey)
      )
        return;
      scope.value = defaults;
      setSnapshot({ key, value: defaults });
      // Cleanup already removed the stored value. Never recreate it from mounted state.
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [defaults, key, parse, userKey]);

  const update = useCallback(
    (patch: Partial<T>) => {
      const scope = activeScope.current;
      if (!key || currentKey.current !== key || !scope || scope.key !== key) return;
      // Parse again on writes to discard unknown fields and bound pasted query text.
      const value = parse(JSON.stringify({ ...scope.value, ...patch }));
      scope.value = value;
      setSnapshot({ key, value });
      try {
        safeBrowserStorage("sessionStorage")?.setItem(key, JSON.stringify(value));
      } catch {
        /* Keep the current page usable when optional persistence is denied. */
      }
    },
    [key, parse],
  );

  // Identity changes are gated during render, before the hydration effect can run.
  return [snapshot.key === key ? snapshot.value : defaults, update];
}
