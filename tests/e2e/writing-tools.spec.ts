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
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://kovagpt.com/writing/ai-text-generator",
  );

  await page.goto("/writing/word-counter");
  await page.getByLabel("Text for Word counter").fill('"Hello." "Goodbye."');
  await page.getByRole("button", { name: "Run Word counter" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toContainText("2 sentences");
  await expect(page.getByRole("status")).toHaveText("Writing result complete.");

  await page.getByLabel("Text for Word counter").fill("你好世界");
  await page.getByRole("button", { name: "Run Word counter" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toContainText("2 words");

  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.markdown",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("Imported Markdown"),
  });
  await expect(page.getByLabel("Text for Word counter")).toHaveValue("Imported Markdown");
});

test("generated rewrites send selected settings and discard stale responses", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route("**/api/write", async (route) => {
    requestBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"text":"Old result"}',
    });
  });

  await page.goto("/writing/paragraph-rewriter");
  await page.getByLabel("Format").selectOption("Email");
  await page.getByLabel("Tone").selectOption("Casual");
  await page.getByLabel("Length").selectOption("Brief");
  const input = page.getByLabel("Text for Paragraph rewriter");
  await input.fill("Original paragraph");
  const runButton = page.getByRole("button", { name: "Run Paragraph rewriter" });
  await runButton.click();

  await expect.poll(() => requestBody).toBeTruthy();
  expect(requestBody?.action).toBe("improve");
  expect(requestBody?.instructions).toContain("casual tone, brief length, and email format");

  await input.fill("Updated while the request is pending");
  releaseResponse?.();
  await expect(runButton).toBeEnabled();
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  await expect(input).toHaveValue("Updated while the request is pending");
});

test("focused checkers hide inapplicable settings and auth errors give sign-in guidance", async ({
  page,
}) => {
  await page.goto("/writing/punctuation-checker");
  await expect(page.getByLabel("Format")).toHaveCount(0);
  await expect(page.getByLabel("Tone")).toHaveCount(0);
  await expect(page.getByLabel("Length")).toHaveCount(0);

  await page.route("**/api/write", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"error":"Unauthorized"}',
    }),
  );
  await page.goto("/writing/ai-text-generator");
  await page.getByLabel("Text for AI text generator").fill("Draft this");
  await page.getByRole("button", { name: "Run AI text generator" }).click();
  await expect(page.getByRole("alert")).toContainText("Sign in to use Kova's generation tools");

  await page.unroute("**/api/write");
  await page.route("**/api/write", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: '{"error":"Daily message limit reached (50/day). Resets in 24 hours or upgrade for more."}',
    }),
  );
  await page.getByLabel("Text for AI text generator").fill("Draft another version");
  await page.getByRole("button", { name: "Run AI text generator" }).click();
  await expect(page.getByRole("alert")).toContainText("Daily message limit reached (50/day)");
  await expect(page.getByRole("alert")).toContainText("review plans for more usage");

  await page.unroute("**/api/write");
  await page.route("**/api/write", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":"Two-factor authentication is required to continue."}',
    }),
  );
  await page.getByLabel("Text for AI text generator").fill("Draft after MFA");
  await page.getByRole("button", { name: "Run AI text generator" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Two-factor authentication is required to continue.",
  );
  await expect(page.getByRole("alert")).not.toContainText("please try again");
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
