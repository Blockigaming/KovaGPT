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

const themeCases = [
  { mode: "dark", system: "light", dark: true },
  { mode: "light", system: "dark", dark: false },
  { mode: "system", system: "dark", dark: true },
  { mode: "system", system: "light", dark: false },
  { mode: null, system: "dark", dark: true },
  { mode: "invalid", system: "dark", dark: true },
  { mode: "blocked", system: "dark", dark: true },
] as const;

for (const { mode, system, dark } of themeCases) {
  test(`theme ${mode ?? "unset"}/${system} paints correctly before hydration`, async ({
    page,
  }, testInfo) => {
    test.skip(!["desktop-1440x900", "phone-390x844"].includes(testInfo.project.name));
    const background = dark ? "oklch(0.175 0.004 255)" : "oklch(1 0 0)";
    const foreground = dark ? "oklch(0.965 0 0)" : "oklch(0.19 0.008 255)";
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
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript((selected) => {
      localStorage.clear();
      if (selected === "blocked") {
        // Exercise theme-storage failure without crashing unrelated app storage.
        const getItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === "kova-theme-mode") throw new DOMException("Storage blocked", "SecurityError");
          return getItem.call(this, key);
        };
      } else if (selected !== null) localStorage.setItem("kova-theme-mode", selected);
      const frames: string[] = [];
      Object.assign(window, { __kovaThemeFrames: frames });
      const sample = () => {
        if (document.body && getComputedStyle(document.body).getPropertyValue("--background")) {
          frames.push(getComputedStyle(document.body).backgroundColor);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, mode);

    let releaseScripts!: () => void;
    const scriptsReleased = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "script") await scriptsReleased;
      await route.continue();
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const root = page.locator("html");
      await expect(root).toHaveAttribute("data-kova-hydration", "pending");
      // The palette is already selected, but React's root markup is unchanged.
      await expect(root).not.toHaveClass(/\bdark\b/);
      await expect(page.locator("body")).toHaveCSS("background-color", background);
      await expect(page.locator("body")).toHaveCSS("color", foreground);
      const serverControl = await page
        .locator('button[aria-label="Add files, tools, or prompts"]')
        .elementHandle();
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      releaseScripts();
      await waitForKovaHydration(page);
      await expect(root).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await expect(page.locator("body")).toHaveCSS("background-color", background);
      await expect(page.locator("body")).toHaveCSS("color", foreground);
      expect(await serverControl!.evaluate((element) => element.isConnected)).toBe(true);
      const frames = await page.evaluate(async () => {
        for (let i = 0; i < 12; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return (window as Window & { __kovaThemeFrames: string[] }).__kovaThemeFrames;
      });
      expect(frames.length).toBeGreaterThan(0);
      expect([...new Set(frames)]).toEqual([background]);
      expect(hydrationErrors).toEqual([]);
      expect(await page.evaluate(() => "__kovaRestoreThemeSelectors" in window)).toBe(false);

      if (mode === "dark") {
        if (testInfo.project.name === "phone-390x844")
          await page.getByRole("button", { name: "Open menu" }).click();
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("combobox", { name: "Appearance" }).click();
        await page.getByRole("option", { name: "Light", exact: true }).click();
        await expect(root).not.toHaveClass(/\bdark\b/);
        await expect(page.locator("body")).toHaveCSS("background-color", "oklch(1 0 0)");
      }
    } finally {
      releaseScripts();
    }
  });
}
