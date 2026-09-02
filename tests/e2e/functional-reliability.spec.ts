import { expect, test } from "@playwright/test";

import { seedGuestConversationsAfterHydration } from "./hydration";

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
    await expect(response.json()).resolves.toEqual({
      error: "Invalid messages.",
    });
  }
});

test("real sharing remains available without the misleading local-member flow", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const now = Date.now();
  await seedGuestConversationsAfterHydration(page, [
    {
      id: "share-reliability",
      title: "Reliability review",
      mode: "instant",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: "m", role: "user", content: "Review this" }],
    },
  ]);
  await page.getByRole("button", { name: "Open chat Reliability review" }).click();
  await page.getByRole("button", { name: "Chat options" }).click();
  await expect(page.getByRole("menuitem", { name: "Share" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Add members/i })).toHaveCount(0);
});
