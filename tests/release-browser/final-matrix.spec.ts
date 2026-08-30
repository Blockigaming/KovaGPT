import { expect, test, type Page } from "@playwright/test";

const themes = ["light", "dark"] as const;

async function waitForHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30_000,
  });
}

for (const theme of themes) {
  test(`${theme} ChatGPT-first shell is usable and Voice-free`, async ({ page }, testInfo) => {
    await page.addInitScript((mode) => localStorage.setItem("kova-theme-mode", mode), theme);
    await page.goto("/");
    await waitForHydration(page);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const authenticated = Boolean(testInfo.project.metadata.authenticated);
    const textarea = page.locator("textarea").first();
    const composer = page.locator(".kova-composer").first();
    await expect(textarea).toBeVisible();
    await expect(composer).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\b(?:Voice mode|Dictate|Start listening|Stop listening)\b/iu);
    await expect(
      page.locator(
        'button[aria-label*="voice" i], button[aria-label*="microphone" i], button[aria-label*="dictate" i]',
      ),
    ).toHaveCount(0);

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.documentHeight).toBeGreaterThan(0);

    await textarea.focus();
    const composerFocus = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        boxShadow: style.boxShadow,
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth || "0"),
      };
    });
    expect(composerFocus.boxShadow).not.toBe("none");
    expect(composerFocus.borderStyle).not.toBe("none");
    expect(composerFocus.borderWidth).toBeGreaterThanOrEqual(1);

    await textarea.fill("Release matrix message");
    const send = composer.getByRole("button", { name: "Send" });
    await expect(send).toBeVisible();
    await expect(send).toBeEnabled();
    await textarea.fill("");

    const width = Number(testInfo.project.metadata.width ?? 0);
    if (width >= 1024) {
      await expect(page.getByRole("button", { name: /new chat/i }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /search chats/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /images/i }).first()).toBeVisible();
    } else {
      const openMenu = page.getByRole("button", { name: "Open menu" }).first();
      await expect(openMenu).toBeVisible();
      const interactiveSizes = await page
        .locator('.kova-composer button:visible, button[aria-label="Open menu"]:visible')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
        );
      for (const size of interactiveSizes) {
        expect(size.width).toBeGreaterThanOrEqual(39);
        expect(size.height).toBeGreaterThanOrEqual(39);
      }
    }

    if (authenticated) {
      await expect(page.getByRole("button", { name: /log in|sign up/i })).toHaveCount(0);
    } else {
      await expect(page.getByRole("button", { name: /log in/i }).first()).toBeVisible();
    }

    await testInfo.attach(`${theme}-${testInfo.project.name}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("critical public and authenticated routes do not expose a broken shell", async ({
  page,
}, testInfo) => {
  const width = Number(testInfo.project.metadata.width ?? 0);
  const browserName = String(testInfo.project.metadata.browserName ?? "");
  test.skip(
    width !== 1280 || browserName !== "chromium",
    "one representative route sweep per auth state",
  );

  const authenticated = Boolean(testInfo.project.metadata.authenticated);
  const routes = authenticated
    ? ["/", "/projects", "/library", "/images", "/scheduled-tasks", "/work", "/notifications"]
    : ["/", "/pricing", "/help", "/status", "/auth"];

  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await waitForHydration(page);
    await expect(page.locator("body")).not.toContainText(
      /this page didn.t load|application error|internal server error/i,
    );
    expect(await page.locator("body").innerText()).not.toHaveLength(0);
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
});

test("production API failure boundaries remain truthful", async ({ request }, testInfo) => {
  const width = Number(testInfo.project.metadata.width ?? 0);
  const browserName = String(testInfo.project.metadata.browserName ?? "");
  test.skip(
    width !== 390 || browserName !== "chromium",
    "one production failure-boundary probe per auth state",
  );

  const malformed = await request.post("/api/chat", {
    headers: { "content-type": "application/json" },
    data: "{",
  });
  expect(malformed.status()).toBe(400);
  const unsupported = await request.post("/api/chat", {
    headers: { "content-type": "text/plain" },
    data: "hello",
  });
  expect(unsupported.status()).toBe(415);
  const missing = await request.get("/__kova_release_missing_route__");
  expect(missing.status()).toBe(404);
});
