import { expect, test } from "@playwright/test";

test("translation hub matches the observed default workspace", async ({ page }) => {
  await page.goto("/translate");
  await expect(page.getByRole("heading", { name: "Translate with Kova" })).toBeVisible();
  await expect(page.getByLabel("Source language", { exact: true })).toHaveValue("Detect language");
  await expect(page.getByLabel("Target language", { exact: true })).toHaveValue("Spanish");
  await expect(
    page.getByRole("button", { name: "Swap source and target languages" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Copy translation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Make it sound more fluent" })).toBeDisabled();
});

test("language-pair route presets both languages and swaps locally", async ({ page }) => {
  await page.goto("/translate/english-to-french");
  await expect(
    page.getByRole("heading", { name: "Translate English To French In Kova" }),
  ).toBeVisible();
  await expect(page.getByLabel("Source language", { exact: true })).toHaveValue("English");
  await expect(page.getByLabel("Target language", { exact: true })).toHaveValue("French");
  await page.getByLabel("Source content to translate").fill("Hello world");
  await page.getByRole("button", { name: "Swap source and target languages" }).click();
  await expect(page.getByLabel("Source language", { exact: true })).toHaveValue("French");
  await expect(page.getByLabel("Target language", { exact: true })).toHaveValue("English");
});

test("translator enables submission without fabricating an unsigned result", async ({ page }) => {
  await page.goto("/translate/tagalog-to-english");
  await page.getByLabel("Source content to translate").fill("Kumusta ka?");
  await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Translation", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Make it professional" })).toBeDisabled();
});

test("unknown language pair uses the real not-found screen without overflow", async ({ page }) => {
  await page.goto("/translate/not-a-real-pair");
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
