import {
  clearPrincipalBrowserStorage,
  dispatchPrincipalBrowserStorageCleared,
} from "./principal-browser-storage.mjs";

/** Clear all stores for a captured principal, including durable image bytes. */
export async function resetPrincipalDeviceData(userKey, options = {}) {
  const result = clearPrincipalBrowserStorage(userKey, options.storage);
  const imageHistory = { cleared: false, failures: [] };
  if (!result.resolved) return { ...result, imageHistory };

  // Invalidate pending image loads and generation before awaiting durable I/O.
  (options.notify ?? dispatchPrincipalBrowserStorageCleared)(userKey);
  if (typeof userKey === "string") {
    try {
      const clear =
        options.clearImageHistory ?? (await import("./image-history.ts")).clearImageHistory;
      await clear(userKey);
      imageHistory.cleared = true;
    } catch {
      imageHistory.failures.push("image_history_clear_failed");
    }
  } else {
    // Guests cannot persist generated images in the account-owned image store.
    imageHistory.cleared = true;
  }
  return { ...result, imageHistory };
}
