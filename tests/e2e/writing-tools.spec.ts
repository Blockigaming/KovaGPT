import { expect, test } from "@playwright/test";

test("writing hub exposes all 21 focused tools", async ({ page }) => {
  await page.goto("/writing");
  await expect(page.getByRole("heading", { name: "Kova writing tools" })).toBeVisible();
  await expect(page.getByRole("link", { name: /AI text generator/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Word counter/ })).toBeVisible();
  await expect(page.locator('main a[href^="/writing/"]')).toHaveCount(21);
});

test("writing tool exposes recovered controls and local word count", async ({ page }) => {
  await page.goto("/writing/ai-text-generator");
  await expect(page.getByRole("heading", { name: "AI text generator" })).toBeVisible();
  await expect(page.getByLabel("Format")).toHaveValue("Text");
  await expect(page.getByLabel("Tone")).toHaveValue("Neutral");
  await expect(page.getByLabel("Length")).toHaveValue("Standard");
  await expect(page.getByLabel("Format").locator("option")).toHaveText([
    "Text",
    "Email",
    "Caption",
    "Article",
    "Social post",
  ]);
  await expect(page.getByLabel("Tone").locator("option")).toHaveText([
    "Friendly",
    "Neutral",
    "Professional",
    "Natural",
    "Concise",
    "Kind",
    "Casual",
  ]);
  await expect(page.getByLabel("Length").locator("option")).toHaveText([
    "Brief",
    "Standard",
    "Detailed",
    "Comprehensive",
  ]);

  const input = page.getByLabel("Text for AI text generator");
  await input.fill("Kova counts these four words.");
  await expect(page.getByText("5 words · 29 characters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run AI text generator" })).toBeEnabled();
});

test("truthful local-only tools never fabricate external analysis", async ({ page }) => {
  await page.goto("/writing/ai-detector");
  await page
    .getByLabel("Text for AI detector")
    .fill("This is a short sample. It has two sentences.");
  await page.getByRole("button", { name: "Run AI detector" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toContainText(
    "does not invent an “AI percentage.”",
  );

  await page.goto("/writing/plagiarism-check");
  await page.getByLabel("Text for Plagiarism checker").fill("A sample that needs source checking.");
  await page.getByRole("button", { name: "Run Plagiarism checker" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toContainText(
    "cannot truthfully report a plagiarism score",
  );
});

test("unknown writing tool uses the real not-found screen without horizontal overflow", async ({
  page,
}) => {
  await page.goto("/writing/not-a-real-tool");
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
