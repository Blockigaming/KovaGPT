import { expect, test } from "@playwright/test";

const themes = ["light", "dark"] as const;

for (const theme of themes) {
  test(`${theme} ChatGPT-first shell is usable and Voice-free`, async ({ page }, testInfo) => {
    await page.addInitScript((mode) => localStorage.setItem("kova-theme-mode", mode), theme);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const authenticated = Boolean(testInfo.project.metadata.authenticated);
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(page.locator(".kova-composer").first()).toBeVisible();

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
    const composerFocus = await page
      .locator(".kova-composer")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth || "0"),
        };
      });
    expect(composerFocus.outlineStyle).not.toBe("none");
    expect(composerFocus.outlineWidth).toBeGreaterThanOrEqual(2);

    const width = Number(testInfo.project.metadata.width ?? 0);
    if (width >= 1024) {
      for (const label of ["New chat", "Search", "Images", "Plugins", "Deep research", "Maps"])
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    } else {
      await expect(page.locator(".kova-topbar")).toBeVisible();
      const interactiveSizes = await page
        .locator(".kova-topbar button:visible, .kova-composer button:visible")
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

test("composer controls expose stable semantic hooks", async ({ page }) => {
  await page.goto("/");
  const composer = page.locator(".kova-composer").first();
  await expect(composer).toBeVisible();
  const textarea = composer.locator("textarea").first();
  await textarea.fill("Release matrix message");
  await expect(composer.locator('[data-testid="send-button"]')).toBeVisible();
  await expect(page.locator("[data-chat-transcript]")).toHaveCount(1);
});

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
