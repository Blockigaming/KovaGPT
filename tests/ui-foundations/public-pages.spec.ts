import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const question = "Can I keep a long project reference without losing its complete text?";

async function theme(page: Page, dark: boolean, enlarged: boolean) {
  await page.evaluate(
    ({ dark, enlarged }) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.largeText = String(enlarged);
    },
    { dark, enlarged },
  );
}

async function horizontalFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const errors: string[] = [];
    if (document.documentElement.scrollWidth > width + 1) errors.push("document overflow");
    for (const node of document.querySelectorAll<HTMLElement>("main, a, button, summary")) {
      if (!node.getClientRects().length) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && (box.left < -1 || box.right > width + 1)) {
        errors.push(`${node.tagName}: ${node.textContent?.trim().slice(0, 100)}`);
      }
    }
    return errors;
  });
}

for (const viewport of viewports) {
  for (const dark of [false, true]) {
    for (const enlarged of [false, true]) {
      const label = `${viewport.width}x${viewport.height} ${dark ? "dark" : "light"} ${enlarged ? "200% root text" : "100% root text"}`;
      test(`public helpers ${label}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: dark ? "dark" : "light" });
        for (const surface of ["public-seo", "public-legal"]) {
          await page.goto(`/?surface=${surface}`);
          await theme(page, dark, enlarged);
          await expect(page.getByRole("main")).toHaveCount(1);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(await horizontalFailures(page), surface).toEqual([]);
          if (surface === "public-seo") {
            const summary = page.locator("summary").filter({ hasText: question });
            await summary.focus();
            await page.keyboard.press("Enter");
            await expect(summary.locator("..")).toHaveAttribute("open", "");
            await page.keyboard.press("Enter");
            await expect(summary.locator("..")).not.toHaveAttribute("open", "");
            await expect(summary).toBeFocused();
            expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(43);
          }
        }
        await page.goto("/?surface=enterprise");
        await theme(page, dark, enlarged);
        await page.getByTestId("trigger").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const submit = dialog.getByRole("button", { name: "Contact sales", exact: true });
        await submit.scrollIntoViewIfNeeded();
        expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(43);
        expect(await horizontalFailures(page), "enterprise dialog").toEqual([]);
        // Deliberately leave required fields empty: no email draft is opened.
        await submit.click();
        await expect(dialog.locator("input:invalid").first()).toBeFocused();
        await expect(dialog.getByRole("status")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("trigger")).toBeFocused();
      });
    }
  }
}

test.describe("every declared public detail record", () => {
  // Each record is rendered from its real registry data. Per-case coverage JSON
  // and failure screenshots avoid retaining thousands of identical DOM traces.
  test.use({ trace: "off" });
  for (const viewport of viewports) {
    for (const dark of [false, true]) {
      for (const enlarged of [false, true]) {
        const label = `${viewport.width}x${viewport.height} ${dark ? "dark" : "light"} ${enlarged ? "200% root text" : "100% root text"}`;
        test(`catalog ${label}`, async ({ page }, testInfo) => {
          test.setTimeout(180_000);
          await page.setViewportSize(viewport);
          await page.emulateMedia({
            reducedMotion: "reduce",
            colorScheme: dark ? "dark" : "light",
          });
          await page.goto("/?surface=public-catalog");
          await theme(page, dark, enlarged);
          const catalog: { path: string; title: string }[] = JSON.parse(
            (await page.locator("#fixture-public-catalog").textContent())!,
          );
          expect(catalog.length).toBeGreaterThan(0);
          expect(new Set(catalog.map((item) => item.path)).size).toBe(catalog.length);
          const checked: string[] = [];
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          try {
            for (const [index, record] of catalog.entries()) {
              await page.evaluate(
                (index) =>
                  window.dispatchEvent(new CustomEvent("kova-fixture-page", { detail: index })),
                index,
              );
              await expect(page.locator("[data-current-public-path]")).toHaveAttribute(
                "data-current-public-path",
                record.path,
              );
              await expect(page.getByRole("heading", { level: 1 })).toHaveText(record.title);
              expect(await horizontalFailures(page), `${record.path} ${label}`).toEqual([]);
              checked.push(record.path);
            }
            expect(errors).toEqual([]);
          } finally {
            await testInfo.attach("public-template-coverage", {
              body: Buffer.from(
                JSON.stringify(
                  {
                    viewport,
                    dark,
                    enlargedRootText: enlarged,
                    total: catalog.length,
                    checked,
                    errors,
                    scope:
                      "Actual template and registry rendering, not application routing, authentication, or production evidence",
                  },
                  null,
                  2,
                ),
              ),
              contentType: "application/json",
            });
          }
        });
      }
    }
  }
});
