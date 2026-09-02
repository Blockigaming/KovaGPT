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

const routeBatches = Array.from({ length: Math.ceil(routes.length / 8) }, (_, index) =>
  routes.slice(index * 8, index * 8 + 8),
);

for (const [batchIndex, batch] of routeBatches.entries()) {
  test(`implemented route batch ${batchIndex + 1}/${routeBatches.length} renders safely`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    test.setTimeout(45_000);
    for (const route of batch) {
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status(), `${route} should be implemented`).toBeLessThan(400);
      await expect(page.locator("body"), `${route} should render a body`).toBeVisible();
      const overflow = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth, `${route} should fit the viewport`).toBeLessThanOrEqual(
        overflow.width + 1,
      );
    }
  });
}

test("guest chat, authentication, command palette, and mobile navigation stay operable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  await page.goto("/");
  await waitForKovaHydration(page);
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
