import { expect, test, type Page } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";

const widths = [320, 375, 390, 768, 1024, 1280, 1440, 1728] as const;
const themes = ["light", "dark"] as const;

async function verifyConversationShell(page: Page, width: number, theme: (typeof themes)[number]) {
  await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).not.toContainText(/\b(?:Voice|Dictate)\b/u);
  await expect(page.locator("textarea:visible").first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document, `${width}px ${theme}: document overflow`).toBeLessThanOrEqual(1);
  expect(overflow.body, `${width}px ${theme}: body overflow`).toBeLessThanOrEqual(1);

  const unnamedVisibleButtons = await page.locator("button:visible").evaluateAll(
    (buttons) =>
      buttons.filter((button) => {
        const label =
          button.getAttribute("aria-label") ??
          button.getAttribute("title") ??
          button.textContent ??
          "";
        return !label.trim();
      }).length,
  );
  expect(unnamedVisibleButtons, `${width}px ${theme}: unnamed visible buttons`).toBe(0);
}

test.describe("ChatGPT-like Kova conversation shell", () => {
  test.describe.configure({ timeout: 120_000 });

  test("signed-out shell is responsive, accessible, restrained, and voice-free", async ({
    page,
  }) => {
    for (const theme of themes) {
      for (const width of widths) await verifyConversationShell(page, width, theme);
    }
  });

  test("signed-in shell uses the same required viewport and theme matrix", async ({ page }) => {
    const mockedBackendOrigins = await installAuthenticatedFixture(page);
    for (const theme of themes) {
      for (const width of widths) {
        await verifyConversationShell(page, width, theme);
        if (width < 1024) {
          await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
        } else {
          await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
        }
      }
    }
    expect(mockedBackendOrigins.size).toBe(1);
  });
});
