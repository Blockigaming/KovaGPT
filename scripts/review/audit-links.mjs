/** Actual Billing legal/help links in the isolated memory router. */
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const output = resolve(process.env.KOVA_CORE_REVIEW_OUTPUT || "../core-ui-review");
const artifact = resolve(output, "KovaGPT-Core-Review.html");
const results = [],
  failures = [];
for (const width of [1440, 390]) {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      "/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell",
    args: ["--no-sandbox", "--single-process", "--no-zygote"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    await page.goto(pathToFileURL(artifact).href);
    const frame = page.frameLocator("iframe");
    await expect(
      frame.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
    ).toBeVisible();
    const control = async (selector, value) => {
      if (width < 700) await page.locator("#controls-toggle").click();
      await page.locator(selector).selectOption(value);
      if (width < 700) await page.locator("#controls-toggle").click();
    };
    await control("#account", "plus");
    for (const [label, path] of [
      ["Refund policy", "/refund"],
      ["Contact support", "/contact-support"],
    ]) {
      await control("#page", "/billing");
      await expect(frame.getByRole("dialog", { name: /Settings/ })).toBeVisible();
      await frame.getByRole("link", { name: label, exact: true }).click();
      await expect(frame.locator("html")).toHaveAttribute("data-review-route", path);
      await frame
        .getByRole("link", { name: /Back to KovaGPT/ })
        .first()
        .click();
      await expect(frame.locator("html")).toHaveAttribute("data-review-route", "/");
      await expect(
        frame.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
      ).toBeVisible();
      results.push({ width, label, path, status: "passed" });
    }
  } catch (error) {
    failures.push({ width, error: error.message });
  } finally {
    await browser.close();
  }
}
await writeFile(
  resolve(output, "link-recheck.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      artifactSha256: createHash("sha256")
        .update(await readFile(artifact))
        .digest("hex"),
      results,
      failures,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
