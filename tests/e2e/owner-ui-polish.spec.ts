import { test, expect } from "@playwright/test";
import { fixture, owner, functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

async function setup(page: import("@playwright/test").Page, saved = false) {
  await fixture(page, "dark", true, saved);
  if (saved)
    await page.addInitScript(
      ({ owner }) => {
        const key = `nova-gpt-conversations-v3:user:${owner}`;
        const chats = JSON.parse(localStorage.getItem(key)!);
        chats[0].messages[1].content = "Hi! How can I help?";
        chats[0].messages[1].createdAt = Date.parse("2026-11-05T21:15:30Z");
        localStorage.setItem(key, JSON.stringify(chats));
      },
      { owner },
    );
}
async function screenshot(page: import("@playwright/test").Page, label: string) {
  await page.screenshot({
    path: `artifacts/owner-ui-${test.info().project.name}-${label}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("short replies fit content, icons are compact, selection is native and menus are minimal", async ({
  page,
}) => {
  await setup(page, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const response = page.getByRole("article", { name: "KovaGPT response" }).first();
  await expect(response).toContainText("Hi! How can I help?");
  const bubble = response.locator(".kova-assistant-message");
  const size = await bubble.boundingBox();
  expect(size!.width).toBeLessThan(300);
  const actions = response.getByRole("toolbar", { name: "Response actions" });
  await expect(actions.getByRole("button", { name: "Read aloud", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Read aloud", exact: true })).toHaveText("");
  await expect(actions.getByText(/Edit in Canvas|Compare versions/)).toHaveCount(0);
  await response.locator(".prose-chat").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(response.locator(".kova-selection-actions")).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
    "Hi! How can I help?",
  );
  await actions.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.locator(".kova-response-menu");
  await expect(menu.locator("time")).toHaveAttribute("datetime", "2026-11-05T21:15:30.000Z");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(menu.getByRole("menuitem")).toHaveText("Branch into new chat");
  await page.keyboard.press("Escape");
  await actions.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Try again.*Thinking/ })).toBeVisible();
  await screenshot(page, "response");
});

test("dedicated settings excludes workspace navigation and supports desktop drag or mobile back", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/settings/responses");
  await waitForKovaHydration(page);
  await expect(page.locator(".kova-sidebar, .kova-sidebar-rail")).toHaveCount(0);
  const navigation = page.getByRole("complementary", { name: "Settings navigation" });
  if (page.viewportSize()!.width >= 768) {
    const edge = page.getByRole("separator", { name: "Resize settings navigation" });
    await edge.focus();
    await edge.press("ArrowRight");
    await expect(edge).toHaveAttribute("aria-valuenow", "290");
    const box = await edge.boundingBox();
    await page.mouse.move(box!.x + 4, box!.y + 100);
    await page.mouse.down();
    await page.mouse.move(box!.x + 64, box!.y + 100);
    await page.mouse.up();
    await expect(edge).toHaveAttribute("aria-valuenow", "350");
    const actual = await navigation.boundingBox();
    expect(actual!.width).toBeCloseTo(350, 0);
  } else {
    await expect(page.getByRole("separator", { name: "Resize settings navigation" })).toBeHidden();
    const back = page.getByRole("button", { name: "Back to settings", exact: true });
    if (await back.isVisible()) await back.click();
    await expect(navigation).toBeVisible();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(navigation).toBeHidden();
    await expect(back).toBeVisible();
  }
  await screenshot(page, "settings");
});

test("profile menu stays inside the sidebar and customization controls fit", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeVisible();
  const sidebar = page.locator("#kova-primary-navigation");
  if (!(await sidebar.isVisible()))
    await page
      .getByRole("button", { name: /^(Open menu|Expand sidebar|Open sidebar)$/ })
      .first()
      .click();
  const account = sidebar.getByRole("button", { name: "Account menu" });
  await expect(account).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await account.click();
  const menu = page.locator(".kova-profile-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Log out", exact: true }).hover();
  await expect(menu).toHaveCSS("outline-style", "none");
  await expect(menu.getByRole("menuitem", { name: "Log out", exact: true })).toHaveCSS(
    "outline-style",
    "none",
  );
  const a = await account.boundingBox(),
    b = await menu.boundingBox();
  expect(b!.width).toBeLessThanOrEqual(a!.width + 1);
  expect(b!.x).toBeGreaterThanOrEqual(a!.x - 1);
  await screenshot(page, "profile");
  await page.keyboard.press("Escape");
  await sidebar.getByText("More", { exact: true }).click();
  await sidebar.getByRole("button", { name: "Customize sidebar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
  await expect(dialog).toBeVisible();
  const range = dialog.getByRole("slider", { name: "Sidebar width" });
  await range.scrollIntoViewIfNeeded();
  const d = await dialog.boundingBox(),
    r = await range.boundingBox();
  expect(r!.x).toBeGreaterThanOrEqual(d!.x);
  expect(r!.x + r!.width).toBeLessThan(d!.x + d!.width);
  await expect(dialog.getByRole("combobox", { name: "Search position" })).toHaveText(/Header icon/);
  await screenshot(page, "customize");
});

test("task filters have breathing room and new task form adapts to each screen", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/_serverFn/**", (route) => {
    const name =
      functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) ?? "";
    if (name.startsWith("isScheduledTasksEligible_"))
      return route.fulfill({
        json: { result: { eligible: true, executionAvailable: true }, context: {} },
      });
    if (name.startsWith("listScheduledTaskOffers_"))
      return route.fulfill({ json: { result: { sent: [], received: [] }, context: {} } });
    if (name.startsWith("listScheduledTasks_"))
      return route.fulfill({ json: { result: [], context: {} } });
    if (name.startsWith("listScheduledTaskConnections_"))
      return route.fulfill({ json: { result: { connections: [], grants: [] }, context: {} } });
    return route.fallback();
  });
  await page.goto("/scheduled-tasks");
  await waitForKovaHydration(page);
  const filters = page.getByRole("tablist", { name: "Task filters" });
  await expect(filters).toBeVisible();
  for (const tab of await filters.getByRole("tab").all())
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await page.getByRole("button", { name: "New scheduled task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New scheduled task" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await screenshot(page, "task");
});

test("Plugins has no workflow skills accordion", async ({ page }) => {
  await setup(page);
  await page.goto("/apps");
  await waitForKovaHydration(page);
  await expect(page.getByText("Workflow skills", { exact: true })).toHaveCount(0);
});

test("returning account never renders the logged-out welcome during delayed validation", async ({
  page,
}) => {
  await setup(page);
  const sessionUser = {
    id: owner,
    aud: "authenticated",
    role: "authenticated",
    email: "shell-parity@example.invalid",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Shell Parity" },
    identities: [],
    factors: [],
    created_at: "2026-01-01T00:00:00Z",
  };
  await page.route("**/auth/v1/user", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: sessionUser });
  });
  await page.addInitScript(() => {
    const state = { flashed: false };
    (window as unknown as { authPaint: { flashed: boolean } }).authPaint = state;
    const check = () => {
      const landing = document.querySelector(".kova-account-gate");
      if (
        landing instanceof HTMLElement &&
        landing.getClientRects().length &&
        getComputedStyle(landing).visibility !== "hidden"
      )
        state.flashed = true;
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { authPaint: { flashed: boolean } }).authPaint.flashed,
    ),
  ).toBe(false);
});
