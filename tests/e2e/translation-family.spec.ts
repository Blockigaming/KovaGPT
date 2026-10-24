import { expect, test } from "@playwright/test";

test("translation hub matches the observed default workspace", async ({ page }) => {
  await page.goto("/translate");
  await expect(
    page.getByRole("heading", { name: "Translate to Spanish with Kova", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Source language", exact: true })).toHaveText(
    "Detect language",
  );
  await expect(page.getByRole("button", { name: "Target language", exact: true })).toHaveText(
    "Spanish",
  );
  await expect(
    page.getByRole("button", { name: "Swap source and target languages" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Copy translation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Make it sound more fluent" })).toBeDisabled();
});

test("language-pair route presets both languages and swaps locally", async ({ page }) => {
  await page.goto("/translate/english-to-french");
  await expect(
    page.getByRole("heading", { name: "Translate English to French with Kova", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Source language", exact: true })).toHaveText(
    "English",
  );
  await expect(page.getByRole("button", { name: "Target language", exact: true })).toHaveText(
    "French",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://kovagpt.com/translate/english-to-french",
  );
  await page.getByLabel("Source content to translate").fill("Hello world");
  await page.getByRole("button", { name: "Swap source and target languages" }).click();
  await expect(page.getByRole("button", { name: "Source language", exact: true })).toHaveText(
    "French",
  );
  await expect(page.getByRole("button", { name: "Target language", exact: true })).toHaveText(
    "English",
  );
  await expect(
    page.getByRole("heading", { name: "Translate French to English with Kova", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Source content to translate")).toHaveValue("Hello world");
});

test("translator enables submission without fabricating an unsigned result", async ({ page }) => {
  await page.goto("/translate/tagalog-to-english");
  await page.getByLabel("Source content to translate").fill("Kumusta ka?");
  await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Translation", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Make it professional" })).toBeDisabled();
});

test("translation ignores stale responses and supports focus and RTL content", async ({ page }) => {
  let requestStarted = false;
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/write", async (route) => {
    requestStarted = true;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"text":"Outdated translation"}',
    });
  });

  await page.goto("/translate/english-to-urdu");
  await expect(page.locator("main#main-content")).toHaveAttribute("tabindex", "-1");
  await expect(page.getByLabel("Source content to translate")).toHaveAttribute("dir", "auto");
  await expect(page.getByLabel("Translation", { exact: true })).toHaveAttribute("dir", "auto");

  await page.getByLabel("Source content to translate").fill("Hello world");
  const translateButton = page.getByRole("button", { name: "Translate", exact: true });
  await translateButton.click();
  await expect.poll(() => requestStarted).toBe(true);
  await page.getByRole("button", { name: "Target language", exact: true }).click();
  await page.getByRole("combobox", { name: "Search target languages", exact: true }).fill("Arabic");
  await page.getByRole("option", { name: "Arabic", exact: true }).click();
  await expect(page.getByRole("button", { name: "Target language", exact: true })).toHaveText(
    "Arabic",
  );
  await expect(
    page.getByRole("heading", { name: "Translate English to Arabic with Kova", exact: true }),
  ).toBeVisible();
  releaseResponse?.();
  await expect(translateButton).toBeEnabled();
  await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("");

  await translateButton.click();
  await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("Outdated translation");
  await expect(page.getByRole("status")).toHaveText("Translation complete.");
});

test("unknown language pair uses the real not-found screen without overflow", async ({ page }) => {
  await page.goto("/translate/not-a-real-pair");
  await expect(page.getByRole("heading", { name: "This page isn’t available" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
