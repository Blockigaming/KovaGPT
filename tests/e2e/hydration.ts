import { expect, type Page } from "@playwright/test";

export async function waitForKovaHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30_000,
  });
}

export async function seedGuestConversationsAfterHydration(
  page: Page,
  conversations: readonly Record<string, unknown>[],
) {
  await waitForKovaHydration(page);
  await page.evaluate((items) => {
    localStorage.setItem("nova-gpt-conversations-v3:guest", JSON.stringify(items));
    window.dispatchEvent(new Event("kova:conversations-imported"));
  }, conversations);
}

export async function seedGuestArchivedConversations(
  page: Page,
  conversations: readonly Record<string, unknown>[],
) {
  await page.evaluate((items) => {
    localStorage.setItem("kovagpt:archived:v2:guest", JSON.stringify(items));
  }, conversations);
}
