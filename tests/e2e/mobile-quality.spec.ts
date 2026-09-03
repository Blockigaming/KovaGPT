import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const mobileProjects = new Set([
  "phone-320x700",
  "phone-375x812",
  "phone-390x844",
  "phone-412x915",
  "phone-landscape-844x390",
  "tablet-768x1024",
]);

async function expectNoPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(!mobileProjects.has(testInfo.project.name));
});

test("navigation opens, contains its controls, and dismisses predictably", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation", exact: true })).toBeVisible();
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(navigation).toBeHidden();
  await expectNoPageOverflow(page);
});

test("composer and attachment sheet stay reachable on narrow screens", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".kova-composer");
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close sheet" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close sheet" }).click();
  await expect(sheet).toBeHidden();
});

test("mobile workspaces and settings never overflow", async ({ page }) => {
  for (const route of ["/projects", "/library", "/apps", "/scheduled-tasks", "/reset-password"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.locator("body")).toBeVisible();
    await expectNoPageOverflow(page);
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click({ force: true });
  const settings = page.locator(".kova-settings-dialog");
  await expect(settings).toBeVisible();
  const box = await settings.boundingBox();
  expect(box).not.toBeNull();
  if (page.viewportSize()!.width < 768) {
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await expectNoPageOverflow(page);
});

test("long rich assistant output scrolls locally instead of widening the page", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"## Mobile report\\n\\nAverylongunbrokenwordthatmustwrapwithoutmovingtheentireviewportsideways.\\n\\n| Metric | Result |\\n|---|---|\\n| Containment | Stable |\\n\\n```ts\\nconst extremelyLongIdentifierThatMustOnlyScrollInsideThisCodeBlock = \'abcdefghijklmnopqrstuvwxyz0123456789\';\\n```"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Show a rich response");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Mobile report" })).toBeVisible();
  await expectNoPageOverflow(page);
  const code = page.locator("pre").first();
  await expect(code).toBeVisible();
  const dimensions = await code.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeGreaterThanOrEqual(dimensions.client);
});
