import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "./principal-browser-storage.mjs";
/** Abort first, then clear React state; late completions cannot refill a cleared view. */
export function createWorkViewLifetime(ownerId, onClear, target = window) {
  const controller = new AbortController();
  const clear = (event) => {
    if (controller.signal.aborted || !isPrincipalBrowserStorageClearedEvent(event, ownerId)) return;
    controller.abort(new Error("work_view_cleared"));
    onClear();
  };
  target.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
  return {
    controller,
    dispose() {
      controller.abort();
      target.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    },
  };
}
