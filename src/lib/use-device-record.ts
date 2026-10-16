import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { readDeviceRecord, saveDeviceRecord } from "./device-records.mjs";
import {
  principalScopedStorageKey,
  safeBrowserStorage,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "./principal-browser-storage.mjs";
/** Device-only recovery. Browser locks serialize cooperating tabs; revision CAS
 * rejects stale drafts. No account-server synchronization is claimed. */
export function useDeviceRecord<T>(
  base: string,
  actor: string | null | undefined,
  target: string,
  empty: T,
  valid: (value: unknown) => value is T,
  guardNavigation = true,
) {
  const key = principalScopedStorageKey(base, actor);
  const identity = JSON.stringify([key, target]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const epoch = useRef(0),
    revision = useRef<string | null>(null),
    deletionEpoch = useRef<string | null>(null),
    edit = useRef(0),
    busy = useRef(false);
  const [state, setState] = useState({
    identity,
    value: empty,
    loaded: false,
    dirty: false,
    error: "",
    epoch: 0,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const scopeEpoch = epoch;
    const generation = ++scopeEpoch.current;
    busy.current = false;
    revision.current = null;
    edit.current = 0;
    const load = () => {
      try {
        const saved = readDeviceRecord(safeBrowserStorage("localStorage"), base, actor, target);
        if (saved.value !== null && !valid(saved.value))
          throw new Error("Saved recovery has an unsupported format; it was preserved.");
        revision.current = saved.revision;
        deletionEpoch.current = saved.deletionEpoch;
        setState({
          identity,
          value: saved.value === null ? empty : saved.value,
          loaded: true,
          dirty: false,
          error: "",
          epoch: generation,
        });
      } catch (e) {
        setState({
          identity,
          value: empty,
          loaded: true,
          dirty: false,
          error: e instanceof Error ? e.message : "Recovery unavailable",
          epoch: generation,
        });
      }
    };
    if (key) load();
    else
      setState({
        identity,
        value: empty,
        loaded: false,
        dirty: false,
        error: "",
        epoch: generation,
      });
    const cleared = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, actor)) return;
      ++epoch.current;
      revision.current = null;
      try {
        deletionEpoch.current = readDeviceRecord(
          safeBrowserStorage("localStorage"),
          base,
          actor,
          target,
        ).deletionEpoch;
      } catch {
        deletionEpoch.current = null;
      }
      busy.current = false;
      edit.current++;
      setState({
        identity,
        value: empty,
        loaded: true,
        dirty: false,
        error: "",
        epoch: epoch.current,
      });
    };
    const storageCleared = (event: StorageEvent) => {
      if (event.key === principalScopedStorageKey("kova-device-record-epoch", actor)) {
        cleared({ detail: { principal: key?.split(":v2:")[1] } } as unknown as Event);
      }
    };
    window.addEventListener("storage", storageCleared);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
    return () => {
      ++scopeEpoch.current;
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
      window.removeEventListener("storage", storageCleared);
    };
  }, [identity, key, base, actor, target, empty, valid, retry]);
  useEffect(() => {
    if (state.identity !== identity || !state.loaded || !state.dirty || state.error || busy.current)
      return;
    const generation = epoch.current,
      capturedEdit = edit.current;
    const timer = window.setTimeout(() => {
      busy.current = true;
      const current = () => identityRef.current === identity && epoch.current === generation;
      void saveDeviceRecord({
        storage: safeBrowserStorage("localStorage"),
        locks: navigator.locks,
        base,
        actor,
        target,
        expectedRevision: revision.current,
        expectedDeletionEpoch: deletionEpoch.current,
        value: state.value,
        current,
      })
        .then((savedRevision) => {
          if (current()) {
            revision.current = savedRevision;
            setState((s) => ({ ...s, dirty: edit.current !== capturedEdit }));
          }
        })
        .catch((e) => {
          if (current())
            setState((s) => ({
              ...s,
              error: e instanceof Error ? e.message : "Device save failed",
            }));
        })
        .finally(() => {
          if (current()) {
            busy.current = false;
            setState((s) => ({ ...s }));
          }
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state, identity, base, actor, target]);
  const visible =
    state.identity === identity
      ? state
      : { identity, value: empty, loaded: false, dirty: false, error: "", epoch: epoch.current };
  useBlocker({
    shouldBlockFn: () =>
      guardNavigation &&
      visible.dirty &&
      !window.confirm(
        "This draft is not saved on this device. Leave and discard the unsaved changes?",
      ),
    enableBeforeUnload: guardNavigation && visible.dirty,
  });
  return {
    ...visible,
    stored: revision.current !== null,
    allowAutomaticAccountHydration:
      visible.loaded && !visible.error && deletionEpoch.current === null,
    setValue: (value: T) => {
      if (!key || !visible.loaded || identityRef.current !== identity) return;
      edit.current++;
      setState((s) => ({ ...s, value, dirty: true }));
    },
    reloadSaved: () => setRetry((n) => n + 1),
    retrySave: () => setState((s) => ({ ...s, error: "" })),
  };
}
