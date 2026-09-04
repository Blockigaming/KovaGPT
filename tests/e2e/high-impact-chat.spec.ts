import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
});

async function startAttachedConversation(
  page: import("@playwright/test").Page,
  expectedResponse: string,
) {
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "brief.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("topic,status\nlaunch,ready"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Original prompt");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".kova-assistant-message")).toContainText(expectedResponse);
}

test("editing a prompt replaces its turn and keeps attachments", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Updated response"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await startAttachedConversation(page, "Updated response");
  await page.getByRole("button", { name: "Edit message" }).click();
  const editingBanner = page.getByText("Editing a previous prompt", { exact: true });
  await expect(editingBanner).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(composer).toHaveValue("Original prompt");
  await composer.fill("Updated prompt");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".kova-user-message")).toHaveCount(1);
  await expect(page.locator(".kova-user-message")).toContainText("Updated prompt");
  await expect(page.locator(".kova-assistant-message")).toContainText("Updated response");
  await expect(editingBanner).toHaveCount(0);

  const messages = requestBody?.messages as Array<Record<string, unknown>>;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toBe("Updated prompt");
  expect(messages[0].attachments).toEqual([
    expect.objectContaining({ kind: "text_file", name: "brief.csv" }),
  ]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("regenerate resends the prompt with its attachment without duplicating the turn", async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Regenerated response"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await startAttachedConversation(page, "Regenerated response");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Retry" }).click();

  await expect(page.locator(".kova-user-message")).toHaveCount(1);
  await expect(page.locator(".kova-assistant-message")).toContainText("Regenerated response");
  const messages = requestBody?.messages as Array<Record<string, unknown>>;
  expect(messages).toHaveLength(1);
  expect(messages[0].attachments).toEqual([
    expect.objectContaining({ kind: "text_file", name: "brief.csv" }),
  ]);
});

test("archived chats can be removed from Settings data controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      "kovagpt:archived:v2:guest",
      JSON.stringify([
        {
          id: "archived-1",
          title: "Archived chat",
          mode: "instant",
          createdAt: now,
          updatedAt: now,
          messages: [{ id: "archived-message", role: "user", content: "Old chat" }],
        },
      ]),
    );
  });
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Data controls" }).click();

  const archived = page.getByRole("region", { name: "Archived chats" });
  await expect(archived).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe('Permanently delete "Archived chat"?');
    await dialog.accept();
  });
  await archived.getByRole("button", { name: "Delete archived chat Archived chat" }).click();
  await expect(archived.getByText("No archived chats", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      legacy: localStorage.getItem("kovagpt:archived"),
      guest: localStorage.getItem("kovagpt:archived:v2:guest"),
    })),
  ).toEqual({ legacy: null, guest: "[]" });
});
test("signed-out chat history stays session-only", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Session response"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Session-only prompt");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".kova-assistant-message")).toContainText("Session response");
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await expect(page.locator(".kova-chat-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat options" })).toHaveCount(0);
});

test("text files are attached as real request context and remain visible in history", async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"The total is 42."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "quarterly.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("metric,value\nrevenue,42"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByText("quarterly.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("What is the revenue?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".kova-user-message").last()).toContainText("What is the revenue?");
  await expect(page.getByText("quarterly.csv", { exact: true })).toBeVisible();
  await expect(page.locator(".kova-assistant-message").last()).toContainText("The total is 42.");
  const messages = requestBody?.messages as Array<{
    attachments?: Array<Record<string, unknown>>;
  }>;
  expect(messages.at(-1)?.attachments).toEqual([
    expect.objectContaining({
      kind: "text_file",
      name: "quarterly.csv",
      content: "metric,value\nrevenue,42",
      fileType: "text/csv",
    }),
  ]);

  await page.getByRole("button", { name: "Edit message" }).last().click();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toHaveValue(
    "What is the revenue?",
  );
  await expect(
    page.getByLabel("Attachments").getByText("quarterly.csv", { exact: true }),
  ).toBeVisible();
});

test("chat API rejects malformed text attachments at the server boundary", async ({ request }) => {
  const response = await request.post("/api/chat", {
    data: {
      messages: [
        {
          role: "user",
          content: "Analyze this",
          attachments: [
            { kind: "text_file", name: "empty.txt", content: "", fileType: "text/plain" },
          ],
        },
      ],
    },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ error: "Invalid text file attachment." }),
  );
});
