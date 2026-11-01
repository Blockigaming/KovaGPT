import { expect, test } from "@playwright/test";
import { fixture, functionNames, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

async function prepare(page: import("@playwright/test").Page) {
  await fixture(page, "dark", true, true, "free");
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  await page.route("**/_serverFn/**", async (route) => {
    const name =
      functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) ?? "";
    const result = name.startsWith("getMyPlanTier_")
      ? { ownerId: owner, tier: "free" }
      : name.startsWith("getMyDailyUsage_")
        ? { chats: 14, thinking: 2, images: 1, uploads: 1, resetsAt: "2026-11-02T00:00:00Z" }
        : name.startsWith("listMemoryCenter_")
          ? [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Response preferences",
                content: "I prefer concise answers.",
                source: "conversation",
                category: "Conversation summary",
                updatedAt: "2026-11-01T00:00:00Z",
              },
            ]
          : undefined;
    if (result !== undefined) return route.fulfill({ json: { result, context: {} } });
    return route.fallback();
  });
}

test("collapsed sidebar is slim, hides search, and Connections uses compact unnumbered tabs", async ({
  page,
}, info) => {
  await prepare(page);
  await page.goto("/apps");
  await waitForKovaHydration(page);
  await expect(page.getByRole("tab", { name: "All", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Connected", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Discover", exact: true })).toHaveCount(0);
  if (page.viewportSize()!.width >= 1024) {
    const rail = page.getByRole("navigation", { name: "Collapsed navigation" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button", { name: "Search chats", exact: true })).toHaveCount(0);
    expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(62);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const card = page.locator(".spec400-plugin-card").first();
  expect((await card.boundingBox())!.height).toBeLessThan(260);
  await page.screenshot({ path: info.outputPath("connections.png"), animations: "disabled" });
});

test("Settings keeps a closed rail, shows percentage usage, and exposes editable Free memory", async ({
  page,
}, info) => {
  await prepare(page);
  await page.goto("/settings/usage");
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("progressbar", { name: "Regular messages used today" }),
  ).toHaveAttribute("aria-valuenow", "24");
  await expect(page.getByRole("progressbar", { name: "Thinking used today" })).toHaveAttribute(
    "aria-valuenow",
    "20",
  );
  await expect(page.getByRole("button", { name: "Close settings", exact: true })).toBeVisible();
  await page.goto("/settings/memory");
  await waitForKovaHydration(page);
  await expect(page.getByRole("switch", { name: "Use saved memory", exact: true })).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Update memory from conversations", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Saved memory summary" })
      .getByText("I prefer concise answers."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review and edit memory", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-memory.png"), animations: "disabled" });
});

test("secondary-page chat menus include Rename, Pin, Share, project choices, and Delete", async ({
  page,
}, info) => {
  test.skip(
    page.viewportSize()!.width < 1024,
    "Desktop submenu; mobile navigation is covered by the drawer suite",
  );
  await prepare(page);
  await page.goto("/library");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Options for Composer review chat", exact: true }).click();
  for (const name of ["Rename", "Pin", "Share", "Delete"])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename chat" });
  await expect(rename.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(rename.getByRole("textbox")).toHaveValue("Composer review chat");
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Options for Composer review chat", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to project", exact: true }).hover();
  await expect(page.getByRole("menuitem", { name: "New project", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Review project", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("chat-project-menu.png"), animations: "disabled" });
  await page.getByRole("menuitem", { name: "Review project", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Move to project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to project", exact: true })).toBeVisible();
});

test("New project from a chat can be canceled and opened again", async ({ page }) => {
  await prepare(page);
  await page.goto("/library");
  await waitForKovaHydration(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    const sidebar = await revealSidebar(page);
    await sidebar
      .getByRole("button", { name: "Options for Composer review chat", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Move to project", exact: true }).click();
    const back = page.getByRole("menuitem", { name: "Back to chat actions", exact: true });
    if (await back.isVisible()) {
      await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeHidden();
      await back.click();
      await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible();
      await page.getByRole("menuitem", { name: "Move to project", exact: true }).click();
    }
    await page.getByRole("menuitem", { name: "New project", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("menuitem", { name: "New project", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.getByRole("menuitem", { name: "New project", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New project", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/projects$/);
  }
});
