import { expect, test, type Page } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { openCurrentSettings } from "./current-ui";

const mobileProjects = new Set([
  "phone-320x700",
  "phone-375x812",
  "phone-390x844",
  "phone-412x915",
  "phone-430x932",
  "phone-landscape-844x390",
  "tablet-768x1024",
  // tablet-1024x768 uses the docked desktop sidebar.
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
  if (page.viewportSize()!.width <= 599) {
    const actions = page.locator(".kova-mobile-home-actions");
    await expect(actions.getByRole("button", { name: /Free offer/ })).toBeVisible();
    const centers = await actions.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const glyph = button.querySelector("svg")!.getBoundingClientRect();
        const { width, height } = button.getBoundingClientRect();
        return { x: glyph.x + glyph.width / 2, target: Math.min(width, height) };
      }),
    );
    expect(centers).toHaveLength(2);
    expect(centers.every((button) => button.target >= 44)).toBe(true);
    // Each press target is centered on its icon, so neighbors sit a full target apart.
    expect(centers[1].x - centers[0].x).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  const search = navigation.getByRole("button", { name: "Search chats", exact: true });
  const close = navigation.getByRole("button", { name: "Close sidebar", exact: true });
  for (const action of [search, close]) {
    await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(action).toHaveCSS("border-top-width", "0px");
    const geometry = await action.evaluate((button) => {
      const target = button.getBoundingClientRect();
      const glyph = button.querySelector("svg")!.getBoundingClientRect();
      return {
        width: button.offsetWidth,
        height: button.offsetHeight,
        dx: glyph.x + glyph.width / 2 - target.x - target.width / 2,
        dy: glyph.y + glyph.height / 2 - target.y - target.height / 2,
      };
    });
    expect(Math.min(geometry.width, geometry.height)).toBeGreaterThanOrEqual(44);
    expect(geometry.dx).toBeCloseTo(action === search ? 6 : -6, 0);
    expect(geometry.dy).toBeCloseTo(0, 0);
  }
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(page.viewportSize()!.width);
  const header = navigation.locator(".kova-sidebar-header");
  await expect(header.locator(".kova-sidebar-header-actions")).toHaveCSS("column-gap", "0px");
  await expect(async () => {
    const gap = await header.evaluate((element) => {
      const brand = element.querySelector<HTMLElement>(".kova-sidebar-brand")!;
      const tools = element.querySelector<HTMLElement>(".kova-sidebar-header-actions")!;
      return (
        tools.getBoundingClientRect().left - brand.getBoundingClientRect().left - brand.scrollWidth
      );
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  }).toPass();
  await search.tap();
  const palette = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
  await expect(palette.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(navigation).toBeVisible();
  await expect(search).toBeFocused();
  await close.tap();
  await expect(navigation).toBeHidden();
  await expectNoPageOverflow(page);
});

test("composer and attachment menu stay reachable on narrow screens", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".spec400-composer");
  await expect(async () => {
    await expect(composer).toBeVisible();
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }).toPass({ timeout: 5_000 });
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Attach files and tools", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add photos & files/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("the single phone composer and drawer retain every workspace destination and the draft", async ({
  page,
}) => {
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 768 || viewport.height <= 500, "portrait phone layout");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const tabs = page.getByRole("navigation", { name: "Mobile workspace" });
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(tabs).toHaveCount(0);
  const appShell = await page.evaluate(
    () => document.documentElement.dataset.kovaSurface === "app",
  );
  // Phones pin one composer to the bottom on web and in the app shell.
  void appShell;
  {
    await expect(page.locator(".kova-composer-tray")).toBeHidden();
    const box = (await page.locator(".spec400-composer:visible").boundingBox())!;
    expect(viewport.height - box.y - box.height).toBeLessThanOrEqual(24);
  }
  await composer.fill("Keep this draft while I change pages");

  for (const name of ["Projects", "Library", "Connections"]) {
    await page.getByRole("button", { name: "Open menu", exact: true }).tap();
    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    const destination = drawer.getByRole("link", { name, exact: true });
    expect((await destination.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (name === "Library") {
      await destination.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("main").getByRole("heading", { name, exact: true, level: 1 }),
      ).toBeFocused();
    } else {
      await destination.tap();
    }
    await expect(page.getByRole("main")).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu", exact: true }).tap();
    await expect(drawer.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoPageOverflow(page);
    await drawer.getByRole("link", { name: "Chat", exact: true }).tap();
    await expect(composer).toHaveValue("Keep this draft while I change pages");
    await expect(composer).not.toBeFocused();
  }
});

test("mobile public header exposes the app and opens its menu without moving the article", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 768, "phone layout");
  await page.goto("/overview", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const navigation = page.getByRole("navigation", { name: "Public navigation", exact: true });
  await expect(navigation.getByRole("link", { name: "Open app" })).toBeInViewport();
  const main = page.getByRole("main");
  const initialY = (await main.boundingBox())!.y;
  await navigation.getByRole("button", { name: "Open navigation" }).tap();
  const menu = page.getByRole("navigation", { name: "Mobile public navigation" });
  await expect(menu.getByRole("link", { name: "About", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect((await main.boundingBox())!.y).toBeCloseTo(initialY, 0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(navigation.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await navigation.getByRole("button", { name: "Open navigation" }).tap();
  await expect(menu).toBeVisible();
  await page.locator("main").dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  await expect(menu).toBeHidden();
});

test("phone footer groups reveal their links without taking over the page", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "phone layout");
  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const footer = page.getByRole("navigation", { name: "Footer navigation" });
  const groups = footer.getByRole("button");
  await expect(groups.first()).toBeVisible();
  await expect(footer.getByRole("link")).toHaveCount(0);
  for (const group of [groups.first(), groups.last()]) {
    await group.focus();
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(footer.locator('[aria-expanded="true"]')).toHaveCount(1);
    await expect(footer.getByRole("link").first()).toBeVisible();
    await expect(group).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(footer.getByRole("link")).toHaveCount(0);
  await expectNoPageOverflow(page);

  const directory = page.locator(".kova-footer-directory");
  await expect(directory.locator('nav[aria-label="All public pages"]')).toHaveCount(0);
  await directory.locator("summary").press("Enter");
  const search = directory.getByRole("searchbox", { name: "Search the page directory" });
  await search.fill("privacy");
  await expect(directory.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  await directory.locator("summary").press("Enter");
  await expect(directory.locator('nav[aria-label="All public pages"]')).toHaveCount(0);
});

test("phone article outlines jump to readable sections below the header", async ({ page }) => {
  const { width, height } = page.viewportSize()!;
  test.skip(width >= 768 && height > 500, "phone layouts only");
  for (const route of ["/academy/ai-fundamentals", "/developers/responses"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const outline = page.locator(".public-phone-outline");
    await outline.getByText("On this page", { exact: true }).tap();
    const sectionLink = outline.getByRole("link").first();
    await expect(sectionLink).toBeVisible();
    await sectionLink.tap();
    await expect(page).toHaveURL(/#section-1$/);
    const content = page.locator("#section-1").getByRole("heading", { level: 2 });
    await expect(content).toBeInViewport();
    // Anchor navigation is smooth for motion-enabled users. Assert the final
    // position rather than an intermediate frame as the heading passes by.
    await expect(async () => {
      const headingBox = await content.boundingBox();
      const headerBox = await page.locator(".kova-public-header").boundingBox();
      expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    }).toPass({ timeout: 5_000 });
    await expectNoPageOverflow(page);
  }
});

test("phone pricing compares all tiers within the screen", async ({ page }) => {
  const { width, height } = page.viewportSize()!;
  test.skip(width >= 768 && height > 500, "phone layouts only");
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const comparison = page.getByRole("region", { name: "Plan comparison" });
  await expect(comparison.getByRole("heading", { name: "Chat modes" })).toBeVisible();
  await expect(comparison.getByRole("table")).toHaveCount(0);
  const row = comparison.locator(".public-phone-plan-row").first();
  await expect(row.locator("dt")).toHaveText(["Free", "Plus", "Pro"]);
  expect(await comparison.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width);
  await expectNoPageOverflow(page);
});

for (const route of ["/projects", "/library", "/apps", "/scheduled-tasks", "/reset-password"]) {
  test(`mobile workspace ${route} never overflows`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.locator("body")).toBeVisible();
    await expectNoPageOverflow(page);
  });
}

test("localized phone landing pages keep the app action and language picker within reach", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 768 && page.viewportSize()!.height > 500);
  for (const [path, direction] of [
    ["/fr-FR", "ltr"],
    ["/ar/home", "rtl"],
  ]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const main = page.locator("main#main-content");
    await expect(main).toHaveAttribute("dir", direction);
    const action = main.getByRole("link");
    const picker = main.getByRole(direction === "rtl" ? "button" : "combobox", {
      name: "Language",
    });
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(picker).toBeInViewport({ ratio: 1 });
    const actionBox = (await action.boundingBox())!;
    const mainBox = (await main.boundingBox())!;
    expect(actionBox.width).toBeGreaterThanOrEqual(mainBox.width - 40);
    expect(actionBox.height).toBeGreaterThanOrEqual(44);
    await expectNoPageOverflow(page);
  }
});

test("secondary workspaces stay usable on narrow and landscape phones", async ({ page }) => {
  const viewport = page.viewportSize()!;
  test.skip(viewport.width !== 320 && viewport.height > 500, "smallest and shortest phone views");
  test.setTimeout(90_000);
  for (const route of [
    "/images",
    "/work",
    "/files",
    "/finances",
    "/notifications",
    "/settings/general",
  ]) {
    await test.step(route, async () => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBe(true);
      await waitForKovaHydration(page);
      await expect(page.getByRole("main").first()).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }
});

test("secondary phone workspaces provide a working skip target", async ({ page }) => {
  for (const path of ["/audit-log", "/kovas", "/write"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const main = page.getByRole("main", { exact: true });
    await expect(main).toHaveAttribute("id", "main-content");
    await page.getByRole("link", { name: "Skip to content", exact: true }).press("Enter");
    await expect(main).toBeFocused();
    await expectNoPageOverflow(page);
  }
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
