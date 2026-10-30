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
    page.getByRole("heading", { level: 1, name: "How can I help today?", exact: true }),
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
  }) => {
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
      page.getByRole("region", { name: "How can I help today?", exact: true }),
    ).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
      includeHidden: true,
    });
    const voice = page.getByRole("button", { name: "Voice", exact: true });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeVisible();
    await expect(send).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveCount(0);
    await expect(voice).toBeVisible();
    await expect(voice).toBeDisabled();
    const logInButton = page
      .getByRole("button", { name: "Log in", exact: true })
      .filter({ visible: true })
      .first();
    await expect(logInButton).toBeVisible();
    // The current interface exposes effort in Options, not a static topbar model label.
    // Guests still cannot access a switchable model picker.
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);

    const mobileLayout = page.viewportSize()!.width < 1024;
    if (mobileLayout) {
      const menuButton = page.getByRole("button", { name: "Open menu" });
      const addButton = page.getByRole("button", {
        name: "Attach",
        exact: true,
      });
      await expect(menuButton).toBeVisible();
      await expect(menuButton).toHaveAttribute("aria-controls", "kova-primary-navigation");
      const navigationTitle = page.locator("[data-kova-navigation-heading]");
      await expect(navigationTitle).toHaveAttribute("role", "heading");
      await expect(navigationTitle).toHaveAttribute("aria-level", "1");
      await expect(
        page.getByRole("heading", { level: 1, name: "KovaGPT", exact: true }),
      ).toBeVisible();
      await expectMinimumTouchTarget(menuButton);
      await expectMinimumTouchTarget(addButton);
      await expectMinimumTouchTarget(voice);
      await expectMinimumTouchTarget(logInButton);
    } else {
      const navigation = page.getByRole("navigation", { name: "Primary navigation", exact: true });
      await expect(navigation).toBeVisible();
      await expect(navigation).toHaveAttribute("id", "kova-primary-navigation");
      await expect(
        navigation.getByRole("navigation", { name: "KovaGPT features", exact: true }),
      ).toBeVisible();
      const brand = navigation.locator(".kova-sidebar-brand");
      await expect(brand).toHaveText("KovaGPT");
      await expect(brand.locator("img")).toHaveCount(1);
      await expect(brand.locator("img")).toHaveAttribute("src", "/kova-logo.png");
      await expect(brand.locator("img")).toHaveAttribute("alt", "");
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
    await expect(responseOptions).toContainText(
      "Choose your model from the bottom of the message box.",
    );
    await expect(responseOptions.getByTestId("thinking-upgrade-button")).toHaveCount(0);
    await expect(page.locator(".spec400-composer-trailing")).toContainText("Default");
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(responseOptions).toBeHidden();
    await expect(options).toBeFocused();

    // Check the typed primary action after the skip-link and Options keyboard
    // paths, so filling the draft cannot disturb the initial Tab sequence.
    await input.fill("Review this editable accessibility draft.");
    await expect(input).toHaveValue("Review this editable accessibility draft.");
    await expect(input).toBeFocused();
    await expect(send).toBeVisible();
    await expect(send).toBeEnabled();
    await expect(voice).toBeHidden();
    if (mobileLayout) await expectMinimumTouchTarget(send);
    await expect(page.locator(".kova-user-message")).toHaveCount(0);
    await input.clear();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(send).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(voice).toBeVisible();
    await expect(voice).toBeDisabled();
    await expect(page.locator(".kova-user-message")).toHaveCount(0);

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
