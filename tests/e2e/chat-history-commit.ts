import { expect, type Page } from "@playwright/test";
import { owner } from "./actual-app-fixture";

// Observe the real account cache transaction. A rendered response or an older
// sync status does not acknowledge the composer's debounced history write.
export async function waitForCommittedChat(page: Page, content: string, title?: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ owner, content, title }) =>
          new Promise<boolean>((resolve) => {
            const request = indexedDB.open("kovagpt-chat-history-v1", 1);
            request.onupgradeneeded = () => request.transaction?.abort();
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("records", "readonly");
              const rows = tx
                .objectStore("records")
                .index("ownerId")
                .getAll(IDBKeyRange.only(owner), 10001);
              tx.oncomplete = () => {
                db.close();
                resolve(
                  rows.result.some(
                    (row) =>
                      (title === undefined || row.record.local?.title === title) &&
                      row.record.local?.messages?.some(
                        (message: { content?: unknown }) =>
                          typeof message.content === "string" && message.content.includes(content),
                      ),
                  ),
                );
              };
              tx.onabort = tx.onerror = () => {
                db.close();
                resolve(false);
              };
            };
          }),
        { owner, content, title },
      ),
    )
    .toBe(true);
}
