import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

const states = [
  { name: "home", route: "/", saved: false },
  { name: "conversation", route: "/", saved: true },
  { name: "library", route: "/library", saved: false },
  { name: "projects", route: "/projects", saved: false },
  { name: "connections", route: "/apps", saved: false },
  { name: "settings", route: "/settings/profile", saved: false },
  { name: "images", route: "/images", saved: false },
  { name: "tasks", route: "/scheduled-tasks", saved: false },
];

for (const state of states) {
  test(`measure ${state.name}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixture(page, "dark", true, state.saved, "plus");
    await page.goto(state.route, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    if (state.route === "/") {
      await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
      if (state.saved) await expect(page.getByText("A practical release checklist:")).toBeVisible();
      else await expect(page.locator(".kova-greeting h1")).toBeVisible();
    } else await expect(page.locator("main#main-content")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const data = await page.evaluate(() => {
      const selectors = [
        ".kova-greeting h1",
        ".spec400-composer",
        ".spec400-input-region",
        ".spec400-composer-input",
        ".spec400-composer-toolbar",
        ".spec400-toolbar-button",
        ".spec400-primary-voice",
        ".kova-model-trigger",
        ".kova-model-static",
        ".kova-topbar",
        ".kova-chat-main",
        ".kova-sidebar",
        ".kova-phone-navigation",
        ".kova-message",
        ".prose-chat",
        ".kova-page-title",
        ".kova-page-header",
        ".spec400-page-header",
        ".kova-file-toolbar",
        ".kova-file-filters",
        ".kova-file-filters button",
        ".kova-file-grid",
        ".spec400-plugin-grid",
        ".spec400-plugin-card",
        ".kova-settings-page",
        "main h1",
        "main h2",
        "main input",
        'main [role="tab"]',
      ];
      return {
        viewport: {
          width: innerWidth,
          height: innerHeight,
          coarse: matchMedia("(pointer: coarse)").matches,
        },
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rows: selectors.flatMap((selector) =>
          [...document.querySelectorAll(selector)]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
            })
            .slice(0, 8)
            .map((element, index) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                selector,
                index,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                inViewport:
                  rect.right > 0 &&
                  rect.bottom > 0 &&
                  rect.left < innerWidth &&
                  rect.top < innerHeight,
                font: style.fontSize,
                line: style.lineHeight,
                weight: style.fontWeight,
                family: style.fontFamily,
                padding: style.padding,
                margin: style.margin,
                gap: style.gap,
                radius: style.borderRadius,
                display: style.display,
                columns: style.gridTemplateColumns,
                position: style.position,
              };
            }),
        ),
      };
    });
    writeFileSync(info.outputPath("geometry.json"), JSON.stringify(data, null, 2));
    await page.screenshot({ path: info.outputPath("layout.png") });
    // Console output contains only geometry from synthetic fixtures, never real account data.
    console.log(
      "KOVA_RATIO",
      JSON.stringify({ project: info.project.name, state: state.name, ...data }),
    );
    expect(errors, `${state.name}: client exceptions`).toEqual([]);
    expect(data.overflow, `${state.name}: page overflow`).toBeLessThanOrEqual(1);
  });
}
