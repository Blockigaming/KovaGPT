import { expect, test, type Locator, type Route } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { dismissMobileSidebar, openComposerAddMenu, revealSidebar } from "../e2e/current-ui";
import { waitForKovaHydration } from "../e2e/hydration";

async function frame(shell: Locator) {
  const header = shell.locator(".kova-topbar:visible");
  await expect(header).toHaveCount(1);
  return {
    header: (await header.boundingBox())!,
    heading: (await shell.locator(".kova-greeting h1").boundingBox())!,
    composer: (await shell.locator(".spec400-composer").boundingBox())!,
    sidebar: await shell.locator(".kova-sidebar").boundingBox(),
  };
}

type HomeFrame = Awaited<ReturnType<typeof frame>>;

function checkOpeningLayout(
  first: HomeFrame,
  { width, height }: { width: number; height: number },
) {
  if (width < 1024 && first.sidebar)
    expect(first.sidebar.x + first.sidebar.width).toBeLessThanOrEqual(1);
  if (width >= 768) return;
  expect(first.composer.width).toBeCloseTo(width - 32, 0);
  expect(height - first.composer.y - first.composer.height).toBeLessThanOrEqual(24);
  const center = first.heading.y + first.heading.height / 2;
  const freeSpaceCenter = (first.header.y + first.header.height + first.composer.y) / 2;
  expect(Math.abs(center - freeSpaceCenter)).toBeLessThanOrEqual(8);
}

function compare(first: HomeFrame, next: HomeFrame, phase: string) {
  for (const surface of ["header", "composer"] as const)
    for (const edge of ["x", "y", "width", "height"] as const)
      expect(
        Math.abs(first[surface][edge] - next[surface][edge]),
        `${surface} ${edge} during ${phase}`,
      ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      first.heading.y + first.heading.height / 2 - (next.heading.y + next.heading.height / 2),
    ),
    `greeting position during ${phase}`,
  ).toBeLessThanOrEqual(2);
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: the server paints the responsive home without app scripts`, async ({ page }) => {
    await fixture(page, theme, true, false, "plus");
    const pending = page.locator("[data-kova-home-startup]");
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await page.route("**/*", (route) =>
      route.request().resourceType() === "script" ? route.abort() : route.fallback(),
    );
    await page.goto("/", { waitUntil: "load" });
    await expect(pending).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "pending");
    await expect(pending).toHaveAttribute("inert", "");
    await expect(input).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    checkOpeningLayout(await frame(pending), page.viewportSize()!);
  });

  // Use a fresh browser profile for successful loading. A previously aborted
  // module request can persist through reload in WebKit.
  test(`${theme}: the home frame stays in place through account readiness and reload`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true, false, "plus", { preserveStorageOnReload: true });
    const viewport = page.viewportSize()!;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pending = page.locator("[data-kova-home-startup]");
    const ready = page.locator(".kova-assistant[data-ui='modern']:not([data-kova-home-startup])");
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const entryDialog = page.locator("dialog[data-kova-entry-pending]");
    const phone = /^(phone|landscape)-/.test(info.project.name);
    const capture = ["desktop-1440", "phone-390"].includes(info.project.name);

    for (const visit of ["first interactive load", "reload"]) {
      let release!: () => void;
      const account = new Promise<void>((resolve) => (release = resolve));
      const holdAccount = async (route: Route) => {
        await account;
        await route.fallback();
      };
      await page.route("**/auth/v1/user", holdAccount);
      let first: HomeFrame;
      try {
        if (visit === "reload") await page.reload({ waitUntil: "load" });
        else await page.goto("/", { waitUntil: "load" });
        await waitForKovaHydration(page);
        await expect(pending).toBeVisible();
        await expect(entryDialog).toHaveAttribute("open", "");
        if (phone) await expect(entryDialog).toHaveCSS("outline-style", "none");
        await expect(input).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        first = await frame(pending);
        checkOpeningLayout(first, viewport);
        if (capture && visit === "first interactive load")
          await page.screenshot({ path: info.outputPath("before-interactive.png") });
      } finally {
        release();
        await page.unroute("**/auth/v1/user", holdAccount);
      }

      await expect(input).toBeEnabled();
      await expect(pending).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (viewport.width < 1024) await expect(input).not.toBeFocused();
      await expect(async () => compare(first, await frame(ready), visit)).toPass({
        timeout: 5_000,
      });
      if (capture && visit === "first interactive load")
        await page.screenshot({ path: info.outputPath("ready.png") });
      await input.fill("Draft typed after startup");
      await expect(input).toHaveValue("Draft typed after startup");
      await input.fill("");
    }
    expect(errors).toEqual([]);
  });
}

test("dark: recommendations and tools open from a clear phone chat", async ({ page }, info) => {
  test.skip(
    info.project.name === "desktop-1440" || info.project.name === "tablet-768",
    "phone layout",
  );
  await fixture(page, "dark", true, true, "plus");
  await page.goto("/", { waitUntil: "load" });
  await waitForKovaHydration(page);
  const shell = page.locator(".kova-assistant[data-ui='modern']:not([data-kova-home-startup])");
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(input).toBeEnabled();
  await shell
    .locator("header.kova-topbar:visible")
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  const homeRecommendations = shell.locator(".kova-empty-chat .spec400-recent-work");
  await expect(homeRecommendations).toBeAttached();
  await expect(homeRecommendations).toBeHidden();
  await expect(shell.locator(".kova-sidebar")).toHaveAttribute("data-state", "closed");
  await page.evaluate(() => document.fonts.ready);
  const opening = await frame(shell);
  checkOpeningLayout(opening, page.viewportSize()!);
  const capture = info.project.name === "phone-390" && !process.env.KOVA_MOBILE_STATE_ENGINE;
  const menu = await openComposerAddMenu(page);
  await expect(menu.getByRole("button", { name: "Choose project", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Plugins", exact: true })).toBeVisible();
  if (capture) await page.screenshot({ path: info.outputPath("composer-menu.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const drawer = await revealSidebar(page);
  const recent = drawer.getByRole("region", { name: "Continue working", exact: true });
  await expect(recent.getByRole("button")).toHaveCount(2);
  if (capture) await page.screenshot({ path: info.outputPath("navigation.png") });
  await dismissMobileSidebar(page);
  compare(opening, await frame(shell), "closing the drawer");
  await revealSidebar(page);
  await recent.getByRole("button", { name: /Composer review chat/ }).click();
  await expect(page.locator("#message-answer-a")).toBeVisible();
  await expect(drawer).toBeHidden();
});
