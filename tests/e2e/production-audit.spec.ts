import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

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

for (const route of routes) {
  test(`implemented route ${route} renders without server errors or horizontal overflow`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} should be implemented`).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth, `${route} should fit the viewport`).toBeLessThanOrEqual(
      overflow.width + 1,
    );
  });
}

test("guest account entry requires login and restores focus after dismissing authentication", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: /message kovagpt/i })).toHaveCount(0);
  const login = page.getByRole("button", { name: "Log in", exact: true });
  await login.click();
  const auth = page.getByRole("dialog", { name: "Log in to Kova", exact: true });
  await expect(auth).toBeVisible();
  await expect(auth.getByPlaceholder("Email address")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(auth).toBeHidden();
  await expect(login).toBeFocused();
  await expect(page.getByRole("button", { name: "Create an account", exact: true })).toBeVisible();
});

test("sensitive and AI endpoints reject unauthenticated or malformed requests", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  const account = await request.delete("/api/account", {
    data: { confirmation: "DELETE" },
  });
  expect(account.status()).toBeGreaterThanOrEqual(400);

  const write = await request.post("/api/write", {
    headers: { "Content-Type": "application/json" },
    data: "not-json",
  });
  expect(write.status()).toBeGreaterThanOrEqual(400);

  const image = await request.post("/api/generate-image", {
    headers: { "Content-Type": "application/json" },
    data: "not-json",
  });
  expect(image.status()).toBeGreaterThanOrEqual(400);
});
