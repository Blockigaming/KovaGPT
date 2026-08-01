import { expect, type Page } from "@playwright/test";

export async function waitForKovaHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30_000,
  });
}
