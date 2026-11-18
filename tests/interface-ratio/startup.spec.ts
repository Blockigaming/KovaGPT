import { expect, test, type Locator, type Route } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

async function frame(shell: Locator) {
  const header = shell.locator(".kova-topbar:visible");
  await expect(header).toHaveCount(1);
  return {
    header: (await header.boundingBox())!,
    heading: (await shell.locator(".kova-greeting h1").boundingBox())!,
    composer: (await shell.locator(".spec400-composer").boundingBox())!,
    sidebar: await shell.locator(".kova-sidebar").boundingBox(),
    navigation: await shell.locator(".kova-phone-navigation").boundingBox(),
  };
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: the responsive home frame is already in place before the app loads`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true, false, "plus", { preserveStorageOnReload: true });
    const viewport = page.viewportSize()!;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pending = page.locator("[data-kova-home-startup]");
    const ready = page.locator(".kova-assistant[data-ui='modern']:not([data-kova-home-startup])");
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });

    // Refuse scripts on the first request so even engines that wait for the
    // load event can finish shaping fonts and capture the server-rendered frame.
    const scriptRoute = (route: Route) =>
      route.request().resourceType() === "script" ? route.abort() : route.fallback();
    await page.route("**/*", scriptRoute);
    await page.goto("/", { waitUntil: "load" });
    await expect(pending).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "pending");
    await expect(pending).toHaveAttribute("inert", "");
    await expect(input).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const first = await frame(pending);
    console.log("KOVA_STARTUP", JSON.stringify({ theme, viewport, first }));
    await page.unroute("**/*", scriptRoute);

    if (viewport.width < 1024) expect(first.sidebar).toBeNull();
    if (viewport.width < 768) {
      expect(first.navigation).not.toBeNull();
      expect(first.composer.width).toBeCloseTo(viewport.width - 32, 0);
      const center = first.heading.y + first.heading.height / 2;
      const freeSpaceCenter = (first.header.y + first.header.height + first.composer.y) / 2;
      expect(Math.abs(center - freeSpaceCenter)).toBeLessThanOrEqual(8);
    }

    const capture = ["desktop-1440", "phone-390"].includes(info.project.name);
    if (capture) await page.screenshot({ path: info.outputPath("before-interactive.png") });

    const compare = (next: Awaited<ReturnType<typeof frame>>, phase: string) => {
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
    };

    for (const visit of ["first interactive load", "reload"]) {
      let release!: () => void;
      const account = new Promise<void>((resolve) => (release = resolve));
      const holdAccount = async (route: Route) => {
        await account;
        await route.fallback();
      };
      await page.route("**/auth/v1/user", holdAccount);
      try {
        await page.reload({ waitUntil: "load" });
        await waitForKovaHydration(page);
        await expect(pending).toBeVisible();
        await expect(page.locator("dialog[data-kova-entry-pending]")).toHaveAttribute("open", "");
        await expect(input).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        compare(await frame(pending), `account check on ${visit}`);
      } finally {
        release();
        await page.unroute("**/auth/v1/user", holdAccount);
      }

      await expect(input).toBeEnabled();
      await expect(pending).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (viewport.width < 1024) await expect(input).not.toBeFocused();
      await expect(async () => compare(await frame(ready), visit)).toPass({ timeout: 5_000 });
      if (capture && visit === "first interactive load")
        await page.screenshot({ path: info.outputPath("ready.png") });
      await input.fill("Draft typed after startup");
      await expect(input).toHaveValue("Draft typed after startup");
      await input.fill("");
    }
    expect(errors).toEqual([]);
  });
}
