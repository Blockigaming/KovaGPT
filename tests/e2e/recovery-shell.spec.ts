import { test, expect } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("workspace search is reachable by touch and restores usable chat", async ({ page }, info) => {
  await coreFixture(page, "dark", "free");
  // This fixture represents a returning Supabase user. In a dual-auth build,
  // resolve the real owned-cookie probe as empty before selecting that session.
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session: null } }));
  await page.goto("/");
  await waitForKovaHydration(page);

  // Auth can settle after hydration and remount the shell. The signed-in rail
  // stays mounted below the desktop CSS breakpoint even though it is hidden.
  const rail = page.getByRole("navigation", {
    name: "Collapsed navigation",
    exact: true,
    includeHidden: true,
  });
  await expect(rail).toBeAttached();
  const mobile = page.viewportSize()!.width < 1024;
  const opener = mobile
    ? page.getByRole("button", { name: "Open menu", exact: true })
    : rail.getByRole("button", { name: "Expand sidebar", exact: true });
  await expect(opener).toBeVisible();
  await opener.click();

  const sidebar = page.locator("#kova-primary-navigation");
  await expect(sidebar).toHaveAttribute("data-state", "open");
  if (mobile) {
    await expect(
      page.getByRole("dialog", { name: "Primary navigation", exact: true }),
    ).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-modal", "true");
  }
  const account = sidebar.getByRole("button", { name: "Account menu", exact: true });
  await expect(account).toBeVisible();
  await expect(account).toContainText("Shell Parity");
  await sidebar
    .getByRole("navigation", { name: "KovaGPT features" })
    .getByRole("button", { name: "Search", exact: true })
    .click();

  const search = page.getByRole("dialog", {
    name: "Search workspace, chats, and actions",
    exact: true,
  });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("aria-modal", "true");
  await expect(
    search.getByRole("combobox", { name: "Search workspace, commands, and chats", exact: true }),
  ).toBeFocused();
  if (mobile) {
    await expect(sidebar).toHaveAttribute("data-state", "closed");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(sidebar).not.toHaveAttribute("aria-modal", "true");
  }
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("workspace-search.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
  const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await expect(composer).toBeEditable();
  await composer.click();
  await expect(composer).toBeFocused();
});
