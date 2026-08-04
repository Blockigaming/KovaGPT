import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_SEND_ON_ENTER,
  composerPreferenceKey,
  legacyComposerSettingsKey,
  readPersistedSendOnEnter,
  scopeForComposerPreference,
} from "@/lib/composer-preference-storage.mjs";

type Listener = () => void;

const values = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

function snapshot(scope: string): boolean {
  return values.get(scope) ?? DEFAULT_SEND_ON_ENTER;
}

function publish(scope: string, value: boolean): void {
  const changed = snapshot(scope) !== value || !values.has(scope);
  values.set(scope, value);
  if (!changed) return;
  listeners.get(scope)?.forEach((listener) => listener());
}

function hydrate(scope: string): void {
  if (typeof window === "undefined") {
    publish(scope, DEFAULT_SEND_ON_ENTER);
    return;
  }
  publish(scope, readPersistedSendOnEnter(window.localStorage, scope));
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
  const scope = scopeForComposerPreference(userKey);
  publish(scope, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(composerPreferenceKey(scope), value ? "1" : "0");
  } catch {
    // Keep the reactive in-memory preference when persistence is unavailable.
  }
}

export function useSharedSendOnEnter(userKey: string | null): boolean {
  const scope = scopeForComposerPreference(userKey);
  const value = useSyncExternalStore(
    (listener) => subscribe(scope, listener),
    () => snapshot(scope),
    () => DEFAULT_SEND_ON_ENTER,
  );

  useEffect(() => {
    hydrate(scope);
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === composerPreferenceKey(scope) ||
        event.key === legacyComposerSettingsKey(scope) ||
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
