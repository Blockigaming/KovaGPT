import { expect, test, type Locator } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

async function frame(shell: Locator) {
  const header = shell.locator(".kova-topbar:visible");
  await expect(header).toHaveCount(1);
  return {
    header: (await header.boundingBox())!,
    heading: (await shell.locator(".kova-greeting h1").boundingBox())!,
    composer: (await shell.locator(".spec400-composer").boundingBox())!,
    sidebar: await shell.locator(".kova-sidebar:visible").boundingBox(),
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

    let scripts: Promise<void> | undefined;
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "script") await scripts;
      await route.fallback();
    });

    for (const reload of [false, true]) {
      let release!: () => void;
      scripts = new Promise<void>((resolve) => (release = resolve));
      let first;
      try {
        if (reload) await page.reload({ waitUntil: "commit" });
        else await page.goto("/", { waitUntil: "commit" });
        await expect(pending).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "pending");
        await expect(pending).toHaveAttribute("inert", "");
        await expect(input).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        first = await frame(pending);
        if (viewport.width < 1024) expect(first.sidebar).toBeNull();
        if (viewport.width < 768) {
          expect(first.navigation).not.toBeNull();
          expect(first.composer.width).toBeCloseTo(viewport.width - 32, 0);
          const center = first.heading.y + first.heading.height / 2;
          const freeSpaceCenter = (first.header.y + first.header.height + first.composer.y) / 2;
          expect(Math.abs(center - freeSpaceCenter)).toBeLessThanOrEqual(8);
        }
        if (!reload && ["desktop-1440", "phone-390"].includes(info.project.name))
          await page.screenshot({ path: info.outputPath("before-interactive.png") });
      } finally {
        release();
      }

      await waitForKovaHydration(page);
      await expect(input).toBeEnabled();
      await expect(pending).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (viewport.width < 1024) await expect(input).not.toBeFocused();
      await expect(async () => {
        const interactive = await frame(ready);
        for (const surface of ["header", "composer"] as const)
          for (const edge of ["x", "y", "width", "height"] as const)
            expect(
              Math.abs(first[surface][edge] - interactive[surface][edge]),
              `${surface} ${edge}, ${reload ? "reload" : "first visit"}`,
            ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(
            first.heading.y +
              first.heading.height / 2 -
              (interactive.heading.y + interactive.heading.height / 2),
          ),
          "greeting stays centered in the same space",
        ).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 5_000 });
      if (!reload && ["desktop-1440", "phone-390"].includes(info.project.name))
        await page.screenshot({ path: info.outputPath("ready.png") });
    }
    expect(errors).toEqual([]);
  });
}
