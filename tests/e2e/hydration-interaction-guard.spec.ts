import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

test("SSR controls wait for hydration and early shortcuts replay once", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");

  const hydrationErrors: string[] = [];
  const captureHydrationError = (message: string) => {
    if (/hydration|#418/iu.test(message)) hydrationErrors.push(message);
  };
  page.on("pageerror", (error) => captureHydrationError(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") captureHydrationError(message.text());
  });

  let releaseScripts!: () => void;
  const scriptsReleased = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await scriptsReleased;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "pending");
  await expect(page.getByText("Reconnect to send", { exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-label="Add files, tools, or prompts"]')).toBeDisabled();

  await page.evaluate(() => {
    const replayed: string[] = [];
    Object.assign(window, { __kovaHydrationTestReplays: replayed });
    window.addEventListener("keydown", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "k" || (event.shiftKey && key === "o")) replayed.push(key);
    });
  });
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Control+Shift+O");

  releaseScripts();
  await waitForKovaHydration(page);
  await expect(page.getByText("Reconnect to send", { exact: true })).toHaveCount(0);
  expect(hydrationErrors).toEqual([]);
  await expect(page.locator('button[aria-label="Add files, tools, or prompts"]')).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __kovaHydrationTestReplays?: string[] })
            .__kovaHydrationTestReplays ?? [],
      ),
    )
    .toEqual(["k", "o"]);
});

test("persisted theme does not mutate the server shell before hydration", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");

  const hydrationErrors: string[] = [];
  const captureHydrationError = (message: string) => {
    if (/(?:hydration|#418|server rendered html|didn't match)/iu.test(message)) {
      hydrationErrors.push(message);
    }
  };
  page.on("pageerror", (error) => captureHydrationError(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") captureHydrationError(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "dark"));

  let releaseScripts!: () => void;
  const scriptsReleased = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await scriptsReleased;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-kova-hydration", "pending");
  await expect(root).not.toHaveClass(/\bdark\b/);

  releaseScripts();
  await waitForKovaHydration(page);
  await expect(root).toHaveClass(/\bdark\b/);
  expect(hydrationErrors).toEqual([]);
});
