import { expect, test, type Page } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { openCurrentSettings } from "./current-ui";
import { functionNames } from "./server-function-fixture";

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

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!mobileProjects.has(testInfo.project.name));
  await installAuthenticatedFixture(page);
});

test("navigation opens, contains its controls, and dismisses predictably", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Close sidebar", exact: true })).toBeVisible();
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await expect(navigation).toBeHidden();
  await expectNoPageOverflow(page);
});

test("composer and attachment menu stay reachable on narrow screens", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".spec400-composer");
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Attach files and tools", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add photos & files/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

for (const route of [
  "/projects",
  "/library",
  "/apps",
  "/scheduled-tasks",
  "/reset-password",
  "/images",
  "/finances",
  "/work",
  "/files",
  "/translate",
  "/write",
]) {
  test(`mobile workspace ${route} never overflows`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.locator("body")).toBeVisible();
    await expectNoPageOverflow(page);
  });
}

test("phone shortcuts and the Library filter sheet work when workspace recents are down", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1024) >= 768);
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (functionNames.get(id)?.startsWith("listWorkspaceRecents_"))
      return route.fulfill({ status: 503, json: { error: "Workspace recents are unavailable." } });
    return route.fallback();
  });
  await page.route("**/api/library/items", (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.operation !== "list")
      return route.fallback();
    return route.fulfill({ json: { items: [], cursor: null, hasMore: false } });
  });
  await page.route("**/api/library/folders", (route) => route.fulfill({ json: { folders: [] } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const shortcuts = page.getByRole("navigation", { name: "Chat shortcuts" });
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/u);
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await filters.click();
  const sheet = page.getByRole("dialog", { name: "Filter Library items" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("combobox", { name: "Source" })).toBeVisible();
  await expect.poll(async () => (await sheet.boundingBox())?.y ?? 0).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(filters).toBeFocused();
});

test("translation separates the source and result on phones", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1024) >= 768);
  await page.goto("/translate", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const source = page.getByRole("textbox", { name: "Source content to translate" });
  const output = page.getByRole("textbox", { name: "Translation", exact: true });
  await source.fill("Hello from Kova.");
  const panels = page.getByRole("group", { name: "Translation panels" });
  await panels.getByRole("button", { name: "Translation", exact: true }).click();
  await expect(output).toBeVisible();
  await expect(source).toBeHidden();
  await panels.getByRole("button", { name: "Source text" }).click();
  await expect(source).toHaveValue("Hello from Kova.");
});

test("mobile settings never overflow", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation", exact: true });
  await expect(navigation).toBeVisible();
  const settings = await openCurrentSettings(page);
  await expect(settings).toBeVisible();
  const box = await settings.boundingBox();
  expect(box).not.toBeNull();
  if (page.viewportSize()!.width < 768) {
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if ((await settings.getAttribute("role")) === "dialog")
      expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    else {
      const reset = settings.getByRole("button", { name: "Reset appearance", exact: true });
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeInViewport({ ratio: 1 });
    }
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
  await page.getByRole("button", { name: "Send message" }).click();
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
