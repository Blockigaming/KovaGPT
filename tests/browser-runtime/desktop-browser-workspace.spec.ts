import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const width of [720, 1280]) {
  test(`desktop browser toolbar navigation, tabs and context at ${width}px`, async ({ page }) => {
    const state = {
      active: "a",
      tabs: [
        {
          id: "a",
          title: "First tab",
          url: "https://example.com/",
          loading: false,
          error: "",
          canGoBack: false,
          canGoForward: false,
        },
      ],
    };
    const copied: string[] = [];
    await page.setViewportSize({ width, height: 850 });
    await page.exposeFunction("browserRequest", async (name: string, value?: string) => {
      if (name === "state") return state;
      if (name === "navigate") {
        state.tabs.find((tab) => tab.id === state.active)!.url = value!;
        return;
      }
      if (name === "newTab") {
        state.active = "b";
        state.tabs.push({ ...state.tabs[0], id: "b", title: "Second tab", url: value! });
        return;
      }
      if (name === "select") {
        state.active = value!;
        return;
      }
      if (name === "close") {
        state.tabs = state.tabs.filter((tab) => tab.id !== value);
        state.active = state.tabs[0]?.id;
        return;
      }
      if (name === "copyContext") {
        copied.push(state.active);
        return { copied: true };
      }
      return;
    });
    await page.addInitScript(() => {
      const methods = [
        "state",
        "navigate",
        "newTab",
        "select",
        "close",
        "back",
        "forward",
        "reload",
        "copyContext",
      ];
      window.kovaBrowser = Object.fromEntries(
        methods.map((method) => [method, (...args) => window.browserRequest(method, ...args)]),
      );
    });
    await page.route("http://browser.test/**", (route) => {
      const script = new URL(route.request().url()).pathname.endsWith(".js");
      return route.fulfill({
        contentType: script ? "text/javascript" : "text/html",
        body: readFileSync(
          join(process.cwd(), "desktop", script ? "browser-ui.js" : "browser.html"),
          "utf8",
        ),
      });
    });
    await page.goto("http://browser.test/");
    await expect(page.getByLabel("Website address")).toHaveValue("https://example.com/");
    await page.getByLabel("Website address").fill("https://example.org/path");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByLabel("Website address")).toHaveValue("https://example.org/path");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(page.getByLabel("Select tab: Second tab")).toBeVisible();
    await page.getByLabel("Select tab: First tab").click();
    await expect(page.getByLabel("Website address")).toHaveValue("https://example.org/path");
    await page.getByRole("button", { name: "Copy context…", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Copied browser context");
    expect(copied).toEqual(["a"]);
    await page.getByLabel("Close tab: Second tab").click();
    await expect(page.getByLabel("Select tab: Second tab")).toHaveCount(0);
    const geometry = await page.getByRole("banner").evaluate((header) => {
      const bounds = header.getBoundingClientRect();
      return {
        height: bounds.height,
        contentHeight: header.scrollHeight,
        width: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.height).toBe(128);
    expect(geometry.contentHeight).toBeLessThanOrEqual(128);
    expect(geometry.width).toBeLessThanOrEqual(width);
  });
}
