import { expect, test, type Page } from "@playwright/test";
import { PUBLIC_REVIEW_PATHS } from "../../src/lib/seo-policy.mjs";
import { coreFixture } from "../e2e/core-app-fixture";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

// Exercise real routed surfaces; only account/service data is synthetic.
const scope = process.env.KOVA_INTERFACE_AUDIT_SCOPE ?? "workspace";
test.describe.configure({ mode: "parallel" });
const workspaceRoutes = [
  "/",
  "/images",
  "/library",
  "/projects",
  "/apps",
  "/scheduled-tasks",
  ...[
    "profile",
    "appearance",
    "responses",
    "notifications",
    "connections",
    "cloud-browser",
    "privacy",
    "usage",
    "billing",
    "memory",
    "security",
    "storage",
    "shortcuts",
    "email",
    "parental",
    "report",
    "help",
    "about",
    "location",
    "family",
  ].map((section) => `/settings/${section}`),
];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectContained(page: Page, route: string) {
  const main = page.locator("main#main-content");
  await expect(main, `${route}: one main landmark`).toHaveCount(1);
  await expect(main).toBeVisible();
  if (scope === "workspace" && route === "/") {
    await expect(main.locator("[data-chat-transcript]")).toBeVisible();
    await expect(
      main.getByRole("article", { name: "KovaGPT response", exact: true }),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Activity", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Share chat", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "More chat actions", exact: true })).toHaveCount(
      0,
    );
  }
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(layout.scroll, `${route}: page must not pan sideways`).toBeLessThanOrEqual(
    layout.width + 1,
  );
  // Native controls must not depend on clipping at the page edge. Local table/menu
  // scrollers are allowed and are exercised by their own interaction tests.
  const controls = main.locator("button:visible, input:visible, textarea:visible, select:visible");
  const outside = await controls.evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!box.width || !box.height || style.visibility !== "visible") return [];
      // The support form's non-focusable, hidden anti-spam field is intentional.
      if (node.getAttribute("aria-hidden") === "true" && node.getAttribute("tabindex") === "-1")
        return [];
      let ancestor = node.parentElement;
      while (ancestor && ancestor !== document.body) {
        const parentStyle = getComputedStyle(ancestor);
        const parentBox = ancestor.getBoundingClientRect();
        if (
          /^(auto|scroll)$/.test(parentStyle.overflowX) &&
          ancestor.scrollWidth > ancestor.clientWidth + 1 &&
          parentBox.left >= -1 &&
          parentBox.right <= document.documentElement.clientWidth + 1
        )
          return [];
        ancestor = ancestor.parentElement;
      }
      return box.left < -1 || box.right > document.documentElement.clientWidth + 1
        ? [
            {
              name: node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 70),
              left: box.left,
              right: box.right,
            },
          ]
        : [];
    }),
  );
  expect(outside, `${route}: native controls outside the screen`).toEqual([]);
}

if (scope === "public") {
  for (const route of PUBLIC_REVIEW_PATHS) {
    test(`public page fits: ${route}`, async ({ page }) => {
      const errors = watchErrors(page);
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status(), route).toBe(200);
      await waitForKovaHydration(page);
      await expectContained(page, route);
      expect(errors, `${route}: client exceptions`).toEqual([]);
    });
  }
} else {
  test("every response action fits without horizontal toolbar scrolling", async ({
    page,
  }, info) => {
    await coreFixture(page, "dark", "plus");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const toolbar = page.getByRole("toolbar", { name: "Response actions", exact: true }).last();
    await toolbar.scrollIntoViewIfNeeded();
    const dimensions = await toolbar.evaluate((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.visible + 1);
    const bounds = await toolbar.boundingBox();
    expect(bounds).not.toBeNull();
    for (const button of await toolbar.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    await page.screenshot({ path: info.outputPath("response-actions.png") });
    await page.route("**/api/speech", (route) =>
      route.fulfill({
        status: 403,
        json: { error: "speech_model_not_eligible" },
      }),
    );
    await toolbar.getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect(toolbar.getByRole("status")).toHaveText(
      "Read aloud is unavailable for this reply. Try a newly generated reply.",
    );
    await expectContained(page, "response speech error");
    expect(
      await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath("response-actions-error.png"),
    });
  });

  test("critical chat sync recovery controls stay inside their notice", async ({ page }, info) => {
    await coreFixture(page, "dark", "plus");
    // Authentication failures require visible recovery; ordinary 503 retries remain unobtrusive.
    await page.route("**/api/chat/history**", (route) =>
      route.fulfill({ status: 401, json: { error: "Synthetic expired session" } }),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const notice = page.getByLabel("Chat history synchronization", {
      exact: true,
    });
    await expect(notice).toBeVisible();
    // Measure recovery controls and their scroll reach in one rendered snapshot.
    await expect(async () => {
      const layout = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>(
          '[aria-label="Chat history synchronization"]',
        )!;
        const bounds = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("button")];
        const originalScroll = element.scrollTop;
        element.scrollTop = element.scrollHeight;
        const lastButton = buttons.at(-1)?.getBoundingClientRect();
        const reachesLastButton = Boolean(
          lastButton && lastButton.top >= bounds.top - 1 && lastButton.bottom <= bounds.bottom + 1,
        );
        element.scrollTop = originalScroll;
        return {
          height: bounds.height,
          left: bounds.left,
          right: bounds.right,
          overflow: getComputedStyle(element).overflowY,
          reachesLastButton,
          buttons: buttons.map((button) => {
            const box = button.getBoundingClientRect();
            return {
              name: button.textContent?.trim(),
              left: box.left,
              right: box.right,
            };
          }),
        };
      });
      expect(layout.height).toBeLessThanOrEqual(
        Math.min(page.viewportSize()!.height * 0.3, 256) + 1,
      );
      expect(layout.overflow).toBe("auto");
      expect(layout.reachesLastButton).toBe(true);
      expect(layout.buttons.map((button) => button.name)).toEqual([
        "Save existing chats to my account",
        "Retry chat sync",
      ]);
      for (const button of layout.buttons) {
        expect(button.left).toBeGreaterThanOrEqual(layout.left);
        expect(button.right).toBeLessThanOrEqual(layout.right);
      }
    }).toPass({ timeout: 5_000 });
    await page.screenshot({ path: info.outputPath("sync-recovery.png") });
  });

  test("transient sync retries stay unobtrusive and do not move the composer", async ({ page }) => {
    // No legacy chats: background retries have no migration decision to show.
    // The pressed-control regression separately covers a pending migration.
    await fixture(page, "dark", true, false, "plus");
    let hold = false;
    let heldRequests = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/chat/history**", async (route) => {
      if (hold) {
        heldRequests++;
        await pending;
      }
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic offline history" },
      });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await page.evaluate(() => document.fonts.ready);
    const notice = page.getByLabel("Chat history synchronization", { exact: true });
    const composer = page.locator(".spec400-composer");
    await expect(composer).toBeVisible();
    await expect(notice).toHaveCount(0);
    const beforeTop = (await composer.boundingBox())!.y;
    hold = true;
    try {
      await expect.poll(() => heldRequests, { timeout: 10_000 }).toBeGreaterThan(0);
      await expect(notice).toHaveCount(0);
      const duringTop = (await composer.boundingBox())!.y;
      expect(Math.abs(duringTop - beforeTop)).toBeLessThanOrEqual(1);
    } finally {
      release();
    }
    await expect(notice).toHaveCount(0);
    expect(Math.abs((await composer.boundingBox())!.y - beforeTop)).toBeLessThanOrEqual(1);
  });

  test("conversation loading keeps composer at the bottom", async ({ page }, info) => {
    await coreFixture(page, "dark", "plus");
    let release!: () => void;
    let heldModules = 0;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/assets/ActiveChatTranscript-*.js", async (route) => {
      heldModules++;
      await pending;
      await route.continue();
    });
    const dock = page.locator(".spec400-composer-dock");
    let loadingBottom!: number;
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect.poll(() => heldModules).toBeGreaterThan(0);
      await expect(page.locator("[data-chat-transcript-loading]")).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      loadingBottom = await dock.evaluate((node) => node.getBoundingClientRect().bottom);
      await page.screenshot({ path: info.outputPath("chat-loading.png") });
    } finally {
      release();
    }
    await expect(page.locator("[data-chat-transcript-loading]")).toHaveCount(0);
    await expectContained(page, "/");
    const loadedBottom = await dock.evaluate((node) => node.getBoundingClientRect().bottom);
    expect(loadedBottom).toBeGreaterThanOrEqual(page.viewportSize()!.height - 24);
    expect(Math.abs(loadingBottom - loadedBottom)).toBeLessThanOrEqual(1);
  });

  for (const theme of ["dark", "light"] as const) {
    for (const route of workspaceRoutes) {
      test(`${theme} workspace fits: ${route}`, async ({ page }, info) => {
        const errors = watchErrors(page);
        await coreFixture(page, theme, "plus");
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await waitForKovaHydration(page);
        await expectContained(page, route);
        expect(errors, `${route}: client exceptions`).toEqual([]);
        if (["/", "/library", "/settings/appearance"].includes(route)) {
          await page.screenshot({
            path: info.outputPath(`${theme}-${route.replaceAll("/", "-") || "home"}.png`),
          });
        }
      });
    }
  }

  test("appearance controls reach both endpoints without clipped controls at enlarged UI size", async ({
    page,
  }, info) => {
    await coreFixture(page, "dark", "plus");
    await page.goto("/settings/appearance", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const size = page.getByRole("slider", {
      name: "Interface size",
      exact: true,
    });
    const navigation = page.getByRole("slider", {
      name: "Settings sidebar width",
      exact: true,
    });
    const phone = await page.evaluate(
      () =>
        matchMedia(
          "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)",
        ).matches,
    );
    const controls = phone
      ? ([[size, "85", "125"]] as const)
      : ([
          [size, "85", "125"],
          [navigation, "200", "440"],
        ] as const);
    if (phone) await expect(navigation).toBeHidden();
    for (const [slider, min, max] of controls) {
      await slider.scrollIntoViewIfNeeded();
      await slider.press("Home");
      await expect(slider).toHaveAttribute("aria-valuenow", min);
      await slider.press("End");
      await expect(slider).toHaveAttribute("aria-valuenow", max);
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    await expectContained(page, "/settings/appearance at 125%");
    await page
      .getByRole("button", { name: "Reset appearance", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
    await expect(size).toHaveAttribute("aria-valuenow", "100");
    if (!phone) await expect(navigation).toHaveAttribute("aria-valuenow", "280");
    await page.screenshot({ path: info.outputPath("appearance-reset.png") });
  });
}
