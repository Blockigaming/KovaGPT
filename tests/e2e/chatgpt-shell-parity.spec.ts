import { expect, test, type Page } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

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

async function expectAuthenticatedDesktopReady(page: Page) {
  await waitForKovaHydration(page);
  // installAuthenticatedFixture owns the late onboarding dialog through its
  // locator handler. Keeping that handler installed settles the overlay only
  // when it appears, without delaying returning users when it is absent.
  await expect(
    page.locator("header").getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
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

  test("returning-user auth loading state stays visually calm", async ({ page }) => {
    await installAuthenticatedFixture(page, { authUserDelayMs: 2_000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible();

    expect(await page.locator(".kova-greeting-mark").count()).toBe(0);
    expect(await page.locator(".kova-starter-grid").count()).toBe(0);
    expect(
      await page
        .getByText("Think through a question, shape an idea, or get a polished first draft.")
        .count(),
    ).toBe(0);
  });

  test("signed-in desktop navigation keeps Chat and Work one step apart", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAuthenticatedFixture(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectAuthenticatedDesktopReady(page);

    const chatNavigation = page.getByRole("navigation", { name: "Primary workspace" });
    await expect(chatNavigation).toBeVisible();
    await expect(chatNavigation.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await chatNavigation.getByRole("link", { name: "Work" }).click();
    await expect(page).toHaveURL(/\/work$/);
    const workNavigation = page.getByRole("navigation", { name: "Primary workspace" });
    await expect(workNavigation).toBeVisible();
    await expect(workNavigation.getByRole("link", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await workNavigation.getByRole("link", { name: "Chat" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("collapsed desktop navigation keeps Work one step away", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installAuthenticatedFixture(page);
    await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectAuthenticatedDesktopReady(page);

    const workLink = page.getByRole("link", { name: "Work" });
    await expect(workLink).toBeVisible();
    await workLink.click();
    await expect(page).toHaveURL(/\/work$/);
  });

  test("active desktop chat keeps secondary actions in one overflow menu", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    await installAuthenticatedFixture(page);
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n',
      });
    });
    await page.route("**/api/title", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: "Header hierarchy" }),
      });
    });
    // The account menu can render before the lazy history runtime opens its
    // writable device view. Its first sync request starts after initialization;
    // wait for that boundary before this header test sends a mocked response.
    const historyInitialized = page.waitForRequest(
      (request) =>
        request.method() === "GET" && new URL(request.url()).pathname === "/api/chat/history",
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectAuthenticatedDesktopReady(page);
    await historyInitialized;
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await input.fill("Check the header");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "Share chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More chat actions" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Chat settings" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Export chat" })).toHaveCount(0);

    await page.getByRole("button", { name: "More chat actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Chat settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Export chat" })).toBeVisible();
  });

  test("active guest desktop chat keeps its local settings action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n',
      });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(input).toBeEnabled();
    await input.fill("Keep guest settings available");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "Share chat" })).toHaveCount(0);
    await page.getByRole("button", { name: "More chat actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Chat settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Export chat" })).toHaveCount(0);
  });

  test("signed-in shell uses the same required viewport and theme matrix", async ({ page }) => {
    const mockedBackendOrigins = await installAuthenticatedFixture(page);
    for (const theme of themes) {
      for (const width of widths) {
        await verifyConversationShell(page, width, theme);
        await expect(page.locator(".kova-greeting-mark")).toHaveCount(0);
        await expect(page.locator(".kova-starter-grid")).toHaveCount(0);
        await expect(
          page.getByText("Think through a question, shape an idea, or get a polished first draft."),
        ).toHaveCount(0);
        if (width < 1024) {
          await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
        } else {
          await expect(
            page.locator("header").getByRole("button", { name: "Account menu", exact: true }),
          ).toBeVisible();
        }
      }
    }
    expect(mockedBackendOrigins.size).toBe(1);
  });
});
