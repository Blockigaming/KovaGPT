import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

// Reviewed desktop measurements from Ubuntu 24.04 / Chromium.
// Compare desktop layouts against these measurements. The composer and
// Connections entries reflect the hosted run 44967410170 and were checked
// against the same rendered layout on main (2a7569f).
const baseline = JSON.parse(
  readFileSync(new URL("./desktop-baseline.json", import.meta.url), "utf8"),
);

const states = [
  { name: "home", route: "/", saved: false },
  { name: "conversation", route: "/", saved: true },
  { name: "library", route: "/library", saved: false },
  { name: "projects", route: "/projects", saved: false },
  { name: "connections", route: "/apps", saved: false },
  { name: "settings", route: "/?settings=profile", saved: false },
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
    if (state.name === "settings") {
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    } else if (state.route === "/") {
      await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
      if (state.saved) await expect(page.getByText("A practical release checklist:")).toBeVisible();
      else await expect(page.locator(".kova-greeting h1")).toBeVisible();
    } else await expect(page.locator("main#main-content")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (info.project.name === "desktop-1440" && state.name !== "settings") {
      // Route entry can briefly scale the whole shell. Measure the settled
      // frame, not an intermediate transform during the entrance animation.
      await expect
        .poll(async () => (await page.locator(".kova-sidebar").boundingBox())?.width)
        .toBe(280);
    }
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
        ".kova-settings-dialog",
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

    const row = (selector: string, index = 0) => {
      const result = data.rows.find((item) => item.selector === selector && item.index === index);
      expect(result, `${state.name}: rendered ${selector}[${index}]`).toBeDefined();
      return result!;
    };
    const desktop = (selector: string, index = 0) =>
      baseline[state.name].find(
        (item: { selector: string; index: number }) =>
          item.selector === selector && item.index === index,
      );
    const unchanged = (selector: string, properties: string[], index = 0) => {
      const actual = row(selector, index);
      const previous = desktop(selector, index);
      for (const property of properties) {
        expect(
          actual[property as keyof typeof actual],
          `${state.name}: ${selector} ${property} ratio 1`,
        ).toEqual(previous[property]);
      }
    };
    if (info.project.name === "desktop-1440" && state.name === "settings") {
      const popup = row(".kova-settings-dialog");
      expect(popup.width).toBeGreaterThan(550);
      expect(popup.width).toBeLessThan(data.viewport.width);
      expect(popup.height).toBeGreaterThan(360);
      expect(popup.height).toBeLessThan(data.viewport.height);
      expect(popup.x * 2 + popup.width).toBeCloseTo(data.viewport.width, 0);
    } else if (info.project.name === "desktop-1440") {
      for (const previous of baseline[state.name]) {
        const actual = row(previous.selector, previous.index);
        for (const [property, value] of Object.entries(previous)) {
          const current = actual[property as keyof typeof actual];
          if (typeof value === "number" && property !== "index") {
            expect(
              Math.abs(Number(current) - value),
              `desktop freeze: ${state.name} ${previous.selector} ${property}`,
            ).toBeLessThanOrEqual(1);
          } else
            expect(
              current,
              `desktop freeze: ${state.name} ${previous.selector} ${property}`,
            ).toEqual(value);
        }
      }
    }
    const phone =
      data.viewport.width < 768 ||
      (data.viewport.width < 1024 && data.viewport.height <= 500 && data.viewport.coarse);
    if (state.name === "connections") {
      const grid = row(".spec400-plugin-grid");
      const card = row(".spec400-plugin-card");
      const next = row(".spec400-plugin-card", 1);
      const columns = grid.columns.split(" ");
      expect(grid.display).toBe("grid");
      expect(columns).toHaveLength(grid.width >= 740 ? 2 : 1);
      expect(card.width).toBeCloseTo(Number.parseFloat(columns[0]), 1);
      expect(card.x + card.width).toBeLessThanOrEqual(grid.x + grid.width);
      expect(next.x + next.width).toBeLessThanOrEqual(grid.x + grid.width);
      expect(card.height).toBeGreaterThanOrEqual(72);
      unchanged(".spec400-plugin-card", ["radius", "gap", "padding"]);
      if (columns.length === 1) {
        expect(next.x).toBe(card.x);
        expect(next.y).toBeGreaterThanOrEqual(card.y + card.height);
      } else {
        expect(next.y).toBe(card.y);
        expect(next.x).toBeGreaterThanOrEqual(card.x + card.width);
      }
    }
    if (!phone) return;
    if (state.name === "home") {
      const welcomeLogo = page.locator(".kova-greeting .kova-home-welcome-logo");
      await expect(welcomeLogo).toBeVisible();
      // Portrait phones show the greeting text under the logo; short landscape
      // phones keep only the logo to leave room for the composer.
      const greetingText = page.locator(".kova-greeting .kova-home-greeting-text");
      if (data.viewport.width < 768) await expect(greetingText).toBeVisible();
      else await expect(greetingText).toBeHidden();
      const expectedSize = Math.min(72, Math.max(48, data.viewport.width * 0.16));
      const logo = await welcomeLogo.boundingBox();
      expect(logo!.width).toBeCloseTo(expectedSize, 1);
      expect(logo!.height).toBeCloseTo(expectedSize, 1);
      expect(row(".spec400-composer").radius).toBe("24px");
      unchanged(".spec400-composer-input", ["font"]);
      expect(row(".spec400-composer-input").line).toBe("24px");
      expect(
        row(".spec400-composer-input").height / desktop(".spec400-composer-input").height,
      ).toBeCloseTo(0.47, 2);
      // The add control, model chip, mic and voice share one compact action row.
      const centers = await page.evaluate(() =>
        [
          'button[aria-label="Attach"]',
          ".kova-consumer-model-trigger, .kova-thinking-toggle",
          "[data-testid=dictate-button]",
          ".spec400-primary-voice",
        ].map((selector) => {
          const box = document.querySelector(selector)!.getBoundingClientRect();
          return box.top + box.height / 2;
        }),
      );
      for (const center of centers) expect(Math.abs(center - centers[0])).toBeLessThanOrEqual(4);
      expect(row(".spec400-composer").height).toBe(96);
      expect(row(".kova-topbar").height).toBe(56);
      expect(row(".spec400-primary-voice").height).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".kova-composer-tray")).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Mobile workspace" })).toHaveCount(0);
    }
    if (state.name === "conversation") {
      unchanged(".prose-chat", ["font"], 1);
      expect(row(".prose-chat", 1).line).toBe("25px");
      expect(row(".spec400-composer").radius).toBe("24px");
    }
    if (state.name === "library") {
      unchanged(".kova-file-filters", ["padding", "radius"]);
      expect(row(".kova-file-filters").gap).toBe("4px");
      unchanged(".kova-file-filters button", ["font", "line", "radius"]);
    }
    if (state.name === "settings") {
      // Settings opens as a modal; its section heading stays in view.
      await expect(page.locator(".kova-settings-content-header h2")).toBeInViewport();
    }
    if (state.name === "tasks") {
      await expect(page.locator("#scheduled-tasks-title")).toHaveCSS("font-size", "26px");
      await expect(page.locator("#scheduled-tasks-title")).toHaveCSS("line-height", "32px");
    }
    if (["library", "projects", "connections", "images"].includes(state.name)) {
      unchanged(".kova-page-title", ["weight"]);
      expect(row(".kova-page-title").font).toBe("26px");
      expect(row(".kova-page-title").height).toBeGreaterThan(20);
    }
  });
}
