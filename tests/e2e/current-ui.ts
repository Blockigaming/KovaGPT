import { expect, type Locator, type Page } from "@playwright/test";
import { SIDEBAR_DRAWER_QUERY } from "../../src/lib/sidebar-viewport";
import { waitForKovaHydration } from "./hydration";

export async function expectsSeparateModeRow(composer: Locator) {
  return composer.evaluate((frame) => {
    const attach = frame.querySelector(".kova-composer-plus");
    const mode = frame.querySelector(
      ".kova-consumer-model-trigger, .kova-thinking-toggle, .kova-home-model-placeholder",
    );
    if (!attach || !mode) return false;
    const attachBox = attach.getBoundingClientRect();
    const modeBox = mode.getBoundingClientRect();
    return modeBox.bottom <= attachBox.top || modeBox.top >= attachBox.bottom;
  });
}

// Response preferences remain in Settings after the composer tray was simplified.
export async function openResponseOptions(page: Page, recordTrigger?: (trigger: Locator) => void) {
  const panel = await openCurrentSettings(page);
  recordTrigger?.(page.getByRole("button", { name: "Account menu", exact: true }));
  await chooseSettingsSection(page, "Responses");
  return panel;
}

export async function closeCurrentSettings(page: Page) {
  const settings = page.locator(".kova-settings-dialog");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
}

export async function openComposerAddMenu(page: Page) {
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const menu = page
    .getByRole("dialog", { name: /^(Attach|Attach files and tools)$/ })
    .filter({ visible: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function composerResourceTrigger(
  page: Page,
  name: "Choose project" | "Files" | "Plugins",
) {
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeEnabled();
  const trayAction = page.locator(".kova-composer-tray").getByRole("button", { name, exact: true });
  if (await trayAction.isVisible()) return trayAction;
  const menu = await openComposerAddMenu(page);
  return menu.getByRole("button", { name, exact: true });
}

export async function revealSidebar(page: Page) {
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  if (!(await navigation.isVisible())) {
    // Match the application breakpoint before choosing a trigger. At 1024px
    // WebKit can briefly report the mobile header as visible while its desktop
    // styles settle, leaving Playwright waiting on a now-hidden mobile button.
    const drawer = await usesSidebarDrawer(page);
    const trigger = page
      .getByRole("button", {
        name: drawer
          ? /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/
          : /^(Open sidebar|Expand sidebar|Toggle sidebar)$/,
      })
      .filter({ visible: true })
      .first();
    try {
      await trigger.click({ timeout: 5_000 });
    } catch (error) {
      // A returning profile can open its saved sidebar while the click waits.
      // That transition already satisfies this helper; other failures still fail.
      if (!(await navigation.isVisible())) throw error;
    }
  }
  await expect(navigation).toBeVisible();
  return navigation;
}

export function usesSidebarDrawer(page: Page) {
  return page.evaluate((query) => matchMedia(query).matches, SIDEBAR_DRAWER_QUERY);
}

export async function dismissMobileSidebar(page: Page) {
  const drawer = page.getByRole("dialog", {
    name: "Primary navigation",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await expect(drawer).toBeHidden();
}

export async function revealContinueWorking(page: Page) {
  await expect(page.locator(".kova-empty-chat .spec400-recent-work")).toBeAttached();
  const recommendations = page.getByRole("region", { name: "Continue working", exact: true });
  if (await recommendations.isVisible()) return recommendations;
  const drawer = await revealSidebar(page);
  const chats = drawer.getByRole("region", { name: "Chats", exact: true });
  await expect(chats).toBeVisible();
  return chats;
}

export async function openCurrentSettings(page: Page) {
  await waitForKovaHydration(page);
  const surface = page.locator(".kova-settings-dialog");
  if (await surface.isVisible()) return surface;
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  const railSettings = page
    .getByRole("navigation", { name: "Collapsed navigation", exact: true })
    .getByRole("button", { name: "Settings", exact: true });
  const account = navigation.getByRole("button", {
    name: "Account menu",
    exact: true,
  });
  try {
    await revealSidebar(page);
    // Authentication can replace the guest Settings button with Account menu.
    // Resolve either real control at click time instead of branching on count().
    await account
      .or(navigation.getByRole("button", { name: "Settings", exact: true }))
      .filter({ visible: true })
      .first()
      .click({ timeout: 4_000 });
  } catch (error) {
    // Only use the rail once the expanded navigation is actually gone. During
    // its animation the rail can still be visible underneath the open footer.
    if ((await navigation.isVisible()) || !(await railSettings.isVisible())) throw error;
    await railSettings.click({ timeout: 4_000 });
  }
  const menuSettings = page.getByRole("menuitem", {
    name: "Settings",
    exact: true,
  });
  await expect(surface.or(menuSettings).filter({ visible: true }).first()).toBeVisible();
  if (!(await surface.isVisible())) await menuSettings.click();
  await expect(surface).toBeVisible({ timeout: 10_000 });
  return surface;
}

export async function chooseSettingsSection(page: Page, section: string) {
  const surface = page.locator(".kova-settings-dialog");
  // The redesigned Settings navigation exposes these as top-level sections.
  // Retain aliases for tests written against the old nested Settings labels.
  const labels: Record<string, string> = {
    "Data control": "Data controls",
    Privacy: "Data controls",
    Responses: "General",
    General: "General",
    Billing: "Subscriptions",
    "Safety & security": "Security and login",
    Security: "Security and login",
    "Keyboard shortcuts": "Keyboard",
    Email: "Account",
    Memory: "Personalization",
    Apps: "Connections",
  };
  const label = labels[section] ?? section;
  const search = surface.getByPlaceholder("Search settings", { exact: true });
  const back = surface.getByRole("button", {
    name: "Back to settings",
    exact: true,
  });
  await expect(search.or(back).filter({ visible: true }).first()).toBeVisible();
  if (!(await search.isVisible())) await back.click();
  // Search includes secondary destinations, so this exercises the actual
  // grouped navigation without assuming that every section is top-level.
  await search.fill(label);
  await surface.getByRole("tab", { name: label, exact: true }).click();
  await expect(surface.getByRole("tabpanel").first()).toBeVisible();
  return surface;
}

// The phone action sheet intentionally provides touch-accessible shortcuts;
// the desktop dropdown remains the minimal two-action menu.
export async function expectResponseMoreActions(page: Page, trigger: Locator) {
  const sheet = (await trigger.getAttribute("aria-haspopup")) === "dialog";
  const menu = sheet
    ? page.getByRole("dialog", { name: "Message actions", exact: true })
    : page.getByRole("menu");
  await expect(menu).toBeVisible();
  if (sheet) {
    for (const name of [
      /^(Copy|Copied)$/,
      "Share",
      /^(Regenerate response|Retry response)$/,
      "Branch in new chat",
      "Search the web",
      /^(Save to Library|Remove from Library)$/,
    ]) {
      await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole("button", { name: "Close sheet", exact: true })).toBeVisible();
  } else {
    const actions = menu.getByRole("menuitem");
    await expect(actions).toHaveCount(2);
    await expect(actions).toHaveText(["Try again", "Branch into new chat"]);
  }
  await expect(menu.locator("time")).toHaveCount(0);
  return menu;
}

export async function confirmChatDeletionIfDrawer(page: Page) {
  if (!(await usesSidebarDrawer(page))) return;
  const confirmation = page.getByRole("dialog", { name: "Delete chat?", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await confirmation.getByRole("button", { name: "Delete chat", exact: true }).click();
  await expect(confirmation).toBeHidden();
}
