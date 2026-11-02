import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

for (const route of ["/", "/library"]) {
  test(`logout opens confirmation without navigating from ${route}`, async ({ page }) => {
    await fixture(page, "dark", true, true, "free");
    await page.goto(route);
    await waitForKovaHydration(page);
    const sidebar = await revealSidebar(page);
    await sidebar.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Log out", exact: true });
    await expect(dialog).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(route);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(route);
  });
}

test("native response selection does not shift the answer or its action bar", async ({ page }) => {
  await fixture(page, "dark", true, true, "free");
  await page.goto("/");
  await waitForKovaHydration(page);
  const response = page.locator(".kova-assistant-message .prose-chat").first();
  await expect(response).toBeVisible();
  const before = await response.boundingBox();
  const selected = await response.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? "").trim()) node = walker.nextNode();
    if (!node) throw new Error("missing selectable prose");
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
  const after = await response.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.height).toBe(before?.height);
});

test("collapsed settings rail has a one-pixel divider", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024);
  await fixture(page, "dark", true, true, "free");
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  await page.goto("/settings/profile");
  await waitForKovaHydration(page);
  await expect(page.getByRole("navigation", { name: "Collapsed navigation" })).toHaveCSS(
    "border-right-width",
    "1px",
  );
});
