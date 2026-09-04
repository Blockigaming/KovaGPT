import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

test.beforeEach(({ page: _page }, testInfo) =>
  test.skip(testInfo.project.name !== "desktop-1440x900"),
);

test("sensitive and malformed API requests fail closed", async ({ request }) => {
  const account = await request.delete("/api/account", {
    data: { confirmation: "DELETE" },
  });
  expect(account.status()).toBe(401);

  for (const data of [
    {},
    { messages: [] },
    { messages: [{ role: "system", content: "untrusted" }] },
    { messages: [{ role: "user", content: 42 }] },
  ]) {
    const response = await request.post("/api/title", { data });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid messages." });
  }
});

test("real sharing remains available without the misleading local-member flow", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Ready to share"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Review this");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Add members/i })).toHaveCount(0);
});
