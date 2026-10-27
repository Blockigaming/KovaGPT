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
    page.getByRole("heading", { level: 1, name: "What are you working on?", exact: true }),
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
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "What are you working on?", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    const logInButton = page
      .getByRole("button", { name: "Log in", exact: true })
      .filter({ visible: true })
      .first();
    await expect(logInButton).toBeVisible();
    // The current interface exposes effort in Options, not a static topbar model label.
    // Guests still cannot access a switchable model picker.
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);

    if (testInfo.project.name.startsWith("phone-")) {
      const menuButton = page.getByRole("button", { name: "Open menu" });
      const addButton = page.getByRole("button", {
        name: "Attach",
        exact: true,
      });
      const sendButton = page.getByRole("button", { name: "Send message", exact: true });
      await expect(menuButton).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: "Kova GPT", exact: true }),
      ).toBeVisible();
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

    const options = page.getByRole("button", { name: "Options", exact: true });
    await options.focus();
    await page.keyboard.press("Enter");
    const responseOptions = page.getByRole("dialog", { name: "Response options", exact: true });
    await expect(responseOptions).toBeVisible();
    const effort = responseOptions.getByRole("region", { name: "Effort", exact: true });
    await expect(
      effort.getByText("Your Free plan uses its included setting. Thinking requires a paid plan.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      effort.getByRole("button", { name: "Thinking is locked. Open Subscriptions", exact: true }),
    ).toBeEnabled();
    await expect(effort.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(responseOptions).toBeHidden();
    await expect(options).toBeFocused();

    // Account policy links live on the full account form. This synthetic local
    // address is never submitted and no password or live account is used.
    await page.goto("/auth?email=accessibility%40example.test&mode=sign-in", {
      waitUntil: "domcontentloaded",
    });
    await waitForKovaHydration(page);
    const policies = page.getByRole("navigation", { name: "Account policies", exact: true });
    await expect(policies).toBeVisible();
    await expect(
      policies.getByRole("link", { name: "Terms of Service (opens in a new tab)", exact: true }),
    ).toHaveAttribute("href", "/terms");
    await expect(
      policies.getByRole("link", { name: "Privacy Policy (opens in a new tab)", exact: true }),
    ).toHaveAttribute("href", "/privacy");
  });
}
