import { test, expect, type Page } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
async function contained(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
}
test.beforeEach(async ({ page }) => {
  await coreFixture(page, "dark");
});
test("Projects filters, full-width cards, and appearance controls", async ({ page }) => {
  await visit(page, "/projects");
  for (const name of ["All projects", "My projects", "Shared with me"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    expect(
      await button.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius)),
    ).toBeGreaterThanOrEqual(20);
  }
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  const grid = page.locator(".kova-file-grid").last();
  await expect(grid).toBeVisible();
  const card = grid.locator(".kova-project-file").first();
  const bounds = await grid.boundingBox(),
    cardBounds = await card.boundingBox();
  expect(cardBounds!.width / bounds!.width).toBeGreaterThan(0.95);
  await page
    .getByRole("button", { name: /new project/i })
    .first()
    .click();
  await expect(page.getByRole("group", { name: "Project appearance" })).toBeVisible();
  await page.getByRole("button", { name: "Use 🚀", exact: true }).click();
  await expect(page.getByLabel("Custom project emoji")).toHaveValue("🚀");
  await expect(page.getByLabel("Upload logo", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Upload background", { exact: true })).toBeVisible();
  await contained(page);
});
test("Library removes secondary panels and equalizes toolbar controls", async ({ page }) => {
  await visit(page, "/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Chat Trash", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Shared chats", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Folders", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move to folder" })).toHaveCount(0);
  const search = await page
    .getByRole("textbox", { name: "Search Library", exact: true })
    .boundingBox();
  const star = await page
    .getByRole("button", { name: "Show favorites", exact: true })
    .boundingBox();
  expect(Math.abs(search!.height - star!.height)).toBeLessThanOrEqual(1);
  expect(star!.height).toBeGreaterThanOrEqual(44);
  await contained(page);
});
test("Scheduled task editor is compact and consistently rounded", async ({ page }) => {
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if ((functionNames.get(id) ?? "").startsWith("isScheduledTasksEligible_"))
      return route.fulfill({
        json: { result: { eligible: true, executionAvailable: true }, context: {} },
      });
    return route.fallback();
  });
  await visit(page, "/scheduled-tasks");
  const search = page.getByPlaceholder("Search tasks");
  const filter = page.getByRole("tablist", { name: "Task filters" });
  await expect(search).toBeVisible();
  expect(
    Math.abs((await search.boundingBox())!.height - (await filter.boundingBox())!.height),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: /new task|create task|new scheduled task/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText(/Saved chat or uploaded context|Connected sources and event filters/),
  ).toHaveCount(0);
  const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first();
  const save = page.getByRole("button", { name: "Save schedule", exact: true });
  const radius = (el: HTMLElement) => getComputedStyle(el).borderRadius;
  expect(await cancel.evaluate(radius)).toEqual(await save.evaluate(radius));
  await contained(page);
});
test("Pricing offers direct Team entry and left-aligned seat prices", async ({ page }) => {
  await visit(page, "/pricing");
  const organizationTab = page.getByRole("button", { name: "Teams & Enterprise", exact: true });
  await organizationTab.click();
  await expect(page.getByRole("link", { name: "Get Team", exact: true })).toHaveAttribute(
    "href",
    "/team",
  );
  await expect(page.getByText("Contact sales about Team", { exact: true })).toHaveCount(0);
  expect(
    await page
      .getByText("Seat price + usage at API rates", { exact: true })
      .evaluate((el) => getComputedStyle(el).textAlign),
  ).toBe("left");
  await contained(page);
});
test("Home shows two spaced recommendations and no Images sidebar shortcut", async ({ page }) => {
  await visit(page, "/");
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  const recommendations = page.locator(".spec400-recent-work li");
  await expect(recommendations).toHaveCount(2);
  expect(
    await page
      .locator(".spec400-recent-work ul")
      .evaluate((el) => parseFloat(getComputedStyle(el).gap)),
  ).toBeGreaterThanOrEqual(16);
  await expect(page.locator('aside a[href="/images"]')).toHaveCount(0);
  await contained(page);
});
test("Settings fits the viewport and has no Archived chats destination", async ({ page }) => {
  await visit(page, "/settings/general");
  await expect(page.locator(".kova-settings-content")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Archived chats", exact: true })).toHaveCount(0);
  await expect(page.getByText("Chat Trash", { exact: true })).toHaveCount(0);
  await contained(page);
  const oversized = await page
    .locator('.kova-settings-content input, .kova-settings-content [role="combobox"]')
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
        }).length,
    );
  expect(oversized).toBe(0);
});
test("Team purchase offers the exact annual and monthly prices with a concrete total", async ({
  page,
}) => {
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if ((functionNames.get(id) ?? "").startsWith("getTeamWorkspace_"))
      return route.fulfill({ json: { result: { teams: [], invitations: [] }, context: {} } });
    return route.fallback();
  });
  await visit(page, "/team");
  await expect(page.getByRole("heading", { name: "Start a team", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Billing period", exact: true }).selectOption("year");
  await page.getByRole("spinbutton", { name: "Premium seats", exact: true }).fill("1");
  await expect(
    page.getByText("3 seats · $1680 per year, plus applicable tax", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Billing period", exact: true }).selectOption("month");
  await expect(
    page.getByText("3 seats · $175 per month, plus applicable tax", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to Team payment", exact: true }),
  ).toBeEnabled();
  await contained(page);
});
