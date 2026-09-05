import {
  clearPrincipalBrowserStorage,
  dispatchPrincipalBrowserStorageCleared,
} from "./principal-browser-storage.mjs";
import { closeChatHistoryOwner } from "./chat-history-bridge.ts";

/** Clear all stores for a captured principal, including durable image bytes. */
export async function resetPrincipalDeviceData(userKey, options = {}) {
  if (userKey === null || typeof userKey === "string") closeChatHistoryOwner(userKey);
  const result = clearPrincipalBrowserStorage(userKey, options.storage);
  const imageHistory = { cleared: false, failures: [] };
  const chatHistory = { cleared: false, failures: [] };
  const pwa = { cleared: false, failures: [] };
  if (!result.resolved) return { ...result, imageHistory, chatHistory, pwa };

  // Invalidate pending image loads and generation before awaiting durable I/O.
  (options.notify ?? dispatchPrincipalBrowserStorageCleared)(userKey);
  if (typeof userKey === "string") {
    try {
      const clear =
        options.clearChatHistory ?? (await import("./chat-history-idb.mjs")).clearChatHistoryDevice;
      await clear(userKey);
      chatHistory.cleared = true;
    } catch {
      chatHistory.failures.push("chat_history_clear_failed");
    }
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
    chatHistory.cleared = true;
  }
  try {
    if (options.clearPwaData) await options.clearPwaData(userKey);
    else if (typeof navigator !== "undefined" && "serviceWorker" in navigator)
      await (await import("./pwa/client.ts")).clearPwaOwner(userKey);
    pwa.cleared = true;
  } catch {
    pwa.failures.push("pwa_clear_failed");
  }
  return { ...result, imageHistory, chatHistory, pwa };
}
