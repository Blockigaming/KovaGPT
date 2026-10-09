import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

type ThemeMode = "light" | "dark";

const selectedProjects = new Set(["phone-390x844", "desktop-1440x900"]);
const themes: ThemeMode[] = ["light", "dark"];

// This is a targeted semantic browser contract, not an automated WCAG-conformance claim.

async function openGuestHome(page: Page, theme: ThemeMode) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((mode: ThemeMode) => {
    window.localStorage.setItem("kova-theme-mode", mode);
  }, theme);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "What can I help with?" }),
  ).toBeVisible();
}

async function expectMinimumTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width + 0.01).toBeGreaterThanOrEqual(44);
  expect(box!.height + 0.01).toBeGreaterThanOrEqual(44);
}

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(
    !selectedProjects.has(testInfo.project.name),
    "The signed-out runtime gate intentionally covers one phone and one desktop viewport.",
  );
});

for (const theme of themes) {
  test(`guest home exposes its core semantic and keyboard contract in ${theme} @a11y`, async ({
    page,
  }, testInfo) => {
    await openGuestHome(page, theme);

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).not.toHaveAttribute("aria-busy", "true");
    if (theme === "dark") {
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    } else {
      await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    }
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "What can I help with?" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add files, tools, or prompts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    const logInButton = page
      .getByRole("button", { name: "Log in", exact: true })
      .filter({ visible: true })
      .first();
    await expect(logInButton).toBeVisible();

    const guestModel = page.locator(".kova-model-static:visible");
    await expect(guestModel).toHaveCount(1);
    expect(await guestModel.evaluate((element) => element.tagName.toLowerCase())).toBe("span");
    await expect(guestModel).not.toHaveAttribute("role");
    await expect(guestModel).not.toHaveAttribute("aria-hidden");
    await expect(guestModel).not.toHaveAttribute("aria-haspopup");
    expect(await guestModel.evaluate((element: HTMLElement) => element.tabIndex)).toBe(-1);
    await expect(guestModel.locator("svg")).toHaveCount(0);

    if (testInfo.project.name.startsWith("phone-")) {
      const menuButton = page.getByRole("button", { name: "Open menu" });
      const addButton = page.getByRole("button", {
        name: "Add files, tools, or prompts",
      });
      const sendButton = page.getByRole("button", { name: "Send" });
      await expect(menuButton).toBeVisible();
      await expectMinimumTouchTarget(menuButton);
      await expectMinimumTouchTarget(addButton);
      await expectMinimumTouchTarget(sendButton);
      await expectMinimumTouchTarget(logInButton);
    } else {
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Search chats" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    }

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveAttribute("href", "#main-content");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/u);
    await expect(page.locator("#main-content")).toBeFocused();

    // The compact home no longer has a legal footer. Guests can still reach both
    // documents through Settings, with a keyboard-operable Help & legal section.
    if (testInfo.project.name.startsWith("phone-"))
      await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    const help = settings.getByRole("button", { name: "Help & legal", exact: true });
    await help.focus();
    await page.keyboard.press("Enter");
    await expect(
      settings.getByRole("heading", { name: "Help & legal", exact: true }),
    ).toBeVisible();
    for (const [name, href] of [
      ["Terms of Service", "/terms"],
      ["Privacy Policy", "/privacy"],
    ]) {
      const link = settings.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
  });
}
