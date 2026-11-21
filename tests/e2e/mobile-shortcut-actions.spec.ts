import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { revealSidebar } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

test("mobile shortcuts keep two independent pins and show explicit replacement", async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch || page.viewportSize()!.width >= 768);
  await fixture(page, "dark", true, false, "plus", { preserveStorageOnReload: true });
  await page.goto("/");
  await waitForKovaHydration(page);
  const drawer = await revealSidebar(page);
  const links = drawer.getByRole("navigation", { name: "Quick navigation" });
  const mobilePins = links.getByRole("link", { name: /^Pinned shortcut:/ });
  await expect(mobilePins).toHaveCount(2);
  const openExplore = () => links.getByRole("button", { name: "Explore", exact: true }).click();
  const desktopSetting = await page.evaluate(
    (key) => localStorage.getItem(key),
    `kova-sidebar-layout-v2:v2:user:${owner}`,
  );
  await openExplore();
  const explore = page.getByRole("dialog", { name: "Explore", exact: true });
  await expect(explore).toHaveAttribute("data-sheet-size", "compact");
  await explore.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(explore).toHaveAttribute("data-sheet-size", "expanded");
  await explore.getByRole("button", { name: "Pin Scheduled tasks", exact: true }).click();
  await expect(
    explore.getByRole("heading", { name: "Replace a shortcut with Scheduled tasks" }),
  ).toBeVisible();
  await explore.getByRole("button", { name: "Replace Library", exact: true }).click();
  await expect(
    explore.getByRole("button", { name: "Unpin Scheduled tasks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await explore.getByRole("button", { name: "Close sheet", exact: true }).click();
  const taskPin = links.getByRole("link", {
    name: "Pinned shortcut: Scheduled tasks",
    exact: true,
  });
  await expect(taskPin).toBeVisible();
  await expect(
    links.getByRole("link", { name: "Pinned shortcut: Library", exact: true }),
  ).toHaveCount(0);
  await expect(mobilePins).toHaveCount(2);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `kova-sidebar-layout-v2:v2:user:${owner}`,
    ),
  ).toBe(desktopSetting);

  await page.reload();
  await waitForKovaHydration(page);
  await revealSidebar(page);
  await expect(taskPin).toBeVisible();
  await taskPin.dispatchEvent("contextmenu", { clientX: 110, clientY: 500 });
  await page.getByRole("menuitem", { name: "Unpin Scheduled tasks", exact: true }).click();
  await expect(taskPin).toHaveCount(0);
  await expect(mobilePins).toHaveCount(1);
});
