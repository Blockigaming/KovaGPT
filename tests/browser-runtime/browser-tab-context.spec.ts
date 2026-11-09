import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("extension popup reads only after preparation and copies only the reviewed preview", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.contextTest = { scripts: 0, queries: 0, copied: [], opened: [] };
    const tab = { id: 8, title: "Selected website", url: "https://example.com/article" };
    window.chrome = {
      tabs: {
        query: async () => {
          window.contextTest.queries++;
          return [tab];
        },
        get: async () => tab,
        create: async (request) => {
          window.contextTest.opened.push(request);
        },
      },
      scripting: {
        executeScript: async () => {
          window.contextTest.scripts++;
          return [{ frameId: 0, result: "My selected paragraph" }];
        },
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.contextTest.copied.push(text);
        },
      },
    });
  });
  await page.route("http://extension.test/**", (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || "popup.html";
    const allowed = ["popup.html", "popup.css", "popup.mjs", "context.mjs"];
    if (!allowed.includes(name)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: name.endsWith(".mjs")
        ? "text/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : "text/html",
      body: readFileSync(join(process.cwd(), "browser-extension", name), "utf8"),
    });
  });
  await page.goto("http://extension.test/popup.html");
  await expect(page.getByRole("button", { name: "Copy context", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.contextTest.queries)).toBe(0);
  await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
  await expect(page.getByLabel("Review and edit what will be copied")).toHaveValue(
    "Selected website\nhttps://example.com/article",
  );
  expect(await page.evaluate(() => window.contextTest.scripts)).toBe(0);
  await page.getByLabel("Include text I selected on this page").check();
  await expect(page.getByRole("button", { name: "Copy context", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
  await expect(page.getByLabel("Review and edit what will be copied")).toHaveValue(
    /My selected paragraph/,
  );
  await page.getByLabel("Review and edit what will be copied").fill("Only this reviewed text");
  await page.getByRole("button", { name: "Copy context", exact: true }).click();
  expect(await page.evaluate(() => window.contextTest.copied)).toEqual(["Only this reviewed text"]);
  await page.getByRole("button", { name: "Open KovaGPT", exact: true }).click();
  expect(await page.evaluate(() => window.contextTest.opened)).toEqual([
    { url: "https://kovagpt.com/" },
  ]);
});
