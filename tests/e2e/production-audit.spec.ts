import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/ai-humanizer",
  "/ai-image-generator",
  "/ai-safety",
  "/ai-writer",
  "/projects",
  "/library",
  "/apps",
  "/audit-log",
  "/changelog",
  "/chatgpt-alternative",
  "/code-helper",
  "/context-packs",
  "/files",
  "/getting-started",
  "/humanize-ai-text",
  "/images",
  "/knowledge-graph",
  "/memory",
  "/modes",
  "/notifications",
  "/omega",
  "/prompt-studio",
  "/research-assistant",
  "/research-planner",
  "/scheduled-tasks",
  "/status",
  "/study-assistant",
  "/summary",
  "/terms",
  "/unsubscribe",
  "/work",
  "/write",
  "/help",
  "/privacy",
  "/pricing",
  "/contact-support",
  "/reset-password",
];

test("implemented routes render without server errors or horizontal overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  test.setTimeout(90_000);
  for (const route of routes) {
    // Finish each document load before navigating again. Rapidly aborting
    // subresource requests can terminate the Cloudflare-backed preview proxy.
    const response = await page.goto(route, { waitUntil: "load" });
    expect(response?.status(), `${route} should be implemented`).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth, `${route} should fit the viewport`).toBeLessThanOrEqual(
      overflow.width + 1,
    );
  }
  // Detach from the local preview origin while this test still owns the page,
  // so Playwright teardown cannot abort a proxy request after the test returns.
  await page.goto("about:blank");
});

test("guest chat, authentication, command palette, and mobile navigation stay operable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: /message kovagpt/i })).toBeVisible();
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(page.getByRole("dialog", { name: /primary navigation/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /primary navigation/i })).toBeHidden();

  await page.getByRole("button", { name: /open menu/i }).click();
  await page
    .getByRole("button", { name: /log in/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByPlaceholder("Email address")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("sensitive and AI endpoints reject unauthenticated requests", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  // These handlers intentionally authenticate before reading their bodies.
  // Keep unauthorized smoke probes bodyless; malformed body contracts belong
  // to focused parser/API tests and an unread request body can reset the local
  // Cloudflare preview proxy after the response has already completed.
  const account = await request.delete("/api/account");
  expect(account.status()).toBeGreaterThanOrEqual(400);

  const write = await request.post("/api/write");
  expect(write.status()).toBeGreaterThanOrEqual(400);

  const image = await request.post("/api/generate-image");
  expect(image.status()).toBeGreaterThanOrEqual(400);
});
