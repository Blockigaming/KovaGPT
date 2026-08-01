import { useEffect, useSyncExternalStore } from "react";

const DEFAULT_SEND_ON_ENTER = true;
const PREFERENCE_KEY_BASE = "kova-composer-send-on-enter-v1";
const LEGACY_SETTINGS_KEY_BASE = "nova-gpt-settings-v1";

type Listener = () => void;

const values = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

function scopeFor(userKey: string | null): string {
  return userKey || "guest";
}

function preferenceKey(scope: string): string {
  return `${PREFERENCE_KEY_BASE}:${scope}`;
}

function legacySettingsKey(scope: string): string {
  return `${LEGACY_SETTINGS_KEY_BASE}:${scope}`;
}

function snapshot(scope: string): boolean {
  return values.get(scope) ?? DEFAULT_SEND_ON_ENTER;
}

function publish(scope: string, value: boolean): void {
  const changed = snapshot(scope) !== value || !values.has(scope);
  values.set(scope, value);
  if (!changed) return;
  listeners.get(scope)?.forEach((listener) => listener());
}

function readPersistedPreference(scope: string): boolean {
  if (typeof window === "undefined") return DEFAULT_SEND_ON_ENTER;
  try {
    const stored = window.localStorage.getItem(preferenceKey(scope));
    if (stored === "1" || stored === "0") return stored === "1";

    // One-time migration for settings saved before the composer preference had
    // its own shared store. This runs after hydration, never during render.
    const legacy = window.localStorage.getItem(legacySettingsKey(scope));
    if (legacy) {
      const sendOnEnter = (JSON.parse(legacy) as { sendOnEnter?: unknown }).sendOnEnter;
      if (typeof sendOnEnter === "boolean") {
        window.localStorage.setItem(preferenceKey(scope), sendOnEnter ? "1" : "0");
        return sendOnEnter;
      }
    }
  } catch {
    // Storage can be disabled. The in-memory preference remains usable.
  }
  return DEFAULT_SEND_ON_ENTER;
}

function hydrate(scope: string): void {
  publish(scope, readPersistedPreference(scope));
}

function subscribe(scope: string, listener: Listener): () => void {
  const scoped = listeners.get(scope) ?? new Set<Listener>();
  scoped.add(listener);
  listeners.set(scope, scoped);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(scope);
  };
}

export function setSharedSendOnEnter(userKey: string | null, value: boolean): void {
  const scope = scopeFor(userKey);
  publish(scope, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(preferenceKey(scope), value ? "1" : "0");
  } catch {
    // Keep the reactive in-memory preference when persistence is unavailable.
  }
}

export function useSharedSendOnEnter(userKey: string | null): boolean {
  const scope = scopeFor(userKey);
  const value = useSyncExternalStore(
    (listener) => subscribe(scope, listener),
    () => snapshot(scope),
    () => DEFAULT_SEND_ON_ENTER,
  );

  useEffect(() => {
    hydrate(scope);
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === preferenceKey(scope) ||
        event.key === legacySettingsKey(scope) ||
        event.key === null
      ) {
        hydrate(scope);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [scope]);

  return value;
}
