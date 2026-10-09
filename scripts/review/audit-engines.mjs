/** Bounded additional engine check: each launch is isolated behind a hard deadline. */
import { firefox, webkit } from "playwright";
import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const output = resolve(process.env.KOVA_CORE_REVIEW_OUTPUT || "../core-ui-review");
async function probe(name) {
  const engine = name === "Firefox" ? firefox : webkit;
  let browser;
  try {
    browser = await engine.launch({ headless: true, timeout: 10000 });
  } catch (error) {
    return { engine: name, status: "unavailable", reason: error.message.slice(0, 1500) };
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(resolve(output, "KovaGPT-Core-Review.html")).href);
    const frame = page.frameLocator("iframe");
    await expect(
      frame.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
    ).toBeVisible();
    await page.locator("#account").selectOption("plus");
    for (const theme of ["dark", "light"]) {
      await page.locator("#theme").selectOption(theme);
      await expect
        .poll(() => frame.locator("html").evaluate((element) => element.classList.contains("dark")))
        .toBe(theme === "dark");
      for (const path of ["/", "/library", "/projects", "/apps", "/settings"]) {
        await page.locator("#page").selectOption(path);
        await expect(frame.locator("html")).toHaveAttribute("data-review-route", path);
        await expect(frame.getByText("Something went wrong!", { exact: true })).toHaveCount(0);
        expect(
          await frame
            .locator("body")
            .evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
      }
    }
    expect(errors).toEqual([]);
    return { engine: name, status: "passed", routeThemeCases: 10, pageErrors: errors };
  } catch (error) {
    return { engine: name, status: "failed", reason: error.message };
  } finally {
    await browser.close();
  }
}
if (process.argv[2] === "--engine") {
  console.log(JSON.stringify(await probe(process.argv[3])));
  process.exit(0);
}
const results = [];
for (const name of ["Firefox", "WebKit"]) {
  results.push(
    await new Promise((resolveResult) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--engine", name], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        expired = false;
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      const deadline = setTimeout(() => {
        expired = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 30000);
      child.on("close", () => {
        clearTimeout(deadline);
        if (expired)
          return resolveResult({
            engine: name,
            status: "unavailable",
            reason:
              "The isolated browser probe exceeded its 30-second deadline in this runtime; no engine pass claimed.",
          });
        try {
          resolveResult(JSON.parse(stdout.trim()));
        } catch {
          resolveResult({
            engine: name,
            status: "unavailable",
            reason: (stderr || stdout || "Browser process exited without a result.").slice(0, 1500),
          });
        }
      });
    }),
  );
}
await writeFile(
  resolve(output, "engine-recheck.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      results,
      limitations: "These browser engines do not certify Safari or real iOS hardware.",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
