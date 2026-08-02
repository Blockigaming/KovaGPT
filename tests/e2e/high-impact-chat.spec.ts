import { expect, test } from "@playwright/test";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "nova-gpt-conversations-v2",
      JSON.stringify([
        {
          id: "editable-chat",
          title: "Editable conversation",
          mode: "instant",
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: "original-user",
              role: "user",
              content: "Original prompt",
              attachments: [
                {
                  kind: "library_file",
                  libraryItemId: "library-1",
                  name: "brief.txt",
                  fileType: "text/plain",
                  size: 42,
                },
              ],
            },
            { id: "original-assistant", role: "assistant", content: "Original response" },
          ],
        },
      ]),
    );
    localStorage.setItem("nova-gpt-pending-active", "editable-chat");
  });
});

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
    expect.objectContaining({ kind: "library_file", libraryItemId: "library-1" }),
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
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Retry" }).click();

  await expect(page.locator(".kova-user-message")).toHaveCount(1);
  await expect(page.locator(".kova-assistant-message")).toContainText("Regenerated response");
  const messages = requestBody?.messages as Array<Record<string, unknown>>;
  expect(messages).toHaveLength(1);
  expect(messages[0].attachments).toEqual([
    expect.objectContaining({ kind: "library_file", libraryItemId: "library-1" }),
  ]);
});

test("archived chats can be removed from Settings data controls", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "kovagpt:archived",
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const dataControl = page.getByRole("tab", { name: "Data control" });
  if ((await dataControl.count()) > 0) {
    await dataControl.click();
  }

  const archived = page.getByRole("region", { name: "Archived chats" });
  await expect(archived).toBeVisible();
  await archived.getByRole("button", { name: "Delete archived chat Archived chat" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Permanently delete this chat?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete permanently" }).click();
  await expect(archived.getByText("No archived chats", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kovagpt:archived"))).toBe("[]");
});
test("deleting a chat offers a working undo", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  const row = page.locator(".kova-chat-row", { hasText: "Editable conversation" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".kova-chat-row", { hasText: "Editable conversation" })).toBeVisible();
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
