import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { openCurrentSettings, chooseSettingsSection } from "./current-ui";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  if (!testInfo.title.startsWith("signed-out"))
    await fixture(page, "light", true, false, "free", {
      preserveStorageOnReload: testInfo.title.startsWith("archived chats"),
    });
});

test("web answers expose their real sources instead of a placeholder action", async ({ page }) => {
  const sourcesEvent = {
    choices: [
      {
        delta: {
          kind: "web_sources",
          sources: [
            {
              id: "src-1",
              title: "Launch report",
              url: "https://reader:secret@example.com/report#details",
              domain: "spoofed.invalid",
              snippet: "Verified launch details.",
            },
            {
              id: "src-2",
              title: "Pricing page",
              url: "https://docs.example.org/pricing",
              domain: "docs.example.org",
            },
            {
              id: "unsafe",
              title: "Unsafe result",
              url: "javascript:alert(1)",
              domain: "unsafe.invalid",
            },
            {
              id: "expanded",
              title: "Expanded URL",
              url: `https://example.net/${"é".repeat(400)}`,
              domain: "example.net",
            },
          ],
        },
      },
    ],
  };
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        `data: ${JSON.stringify(sourcesEvent)}\n\n` +
        'data: {"choices":[{"delta":{"content":"The launch report confirms the update."}}]}\n\ndata: [DONE]\n\n',
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Find the launch details");
  await page.getByRole("button", { name: "Send message" }).click();

  const sourcesButton = page.getByRole("button", { name: "2 sources" });
  await expect(sourcesButton).toBeVisible();
  await sourcesButton.click();
  const sources = page.getByRole("dialog", { name: "Sources", exact: true });
  await expect(
    sources.getByRole("link", { name: /https:\/\/example.com\/report/ }),
  ).toHaveAttribute("href", "https://example.com/report");
  await expect(sources).toContainText("Verified launch details.");
  await expect(sources.getByText("Publisher: example.com", { exact: true })).toBeVisible();
  await expect(sources).not.toContainText("spoofed.invalid");
  await expect(sources).not.toContainText("Unsafe result");
  await expect(sources).not.toContainText("Expanded URL");
  await expect(sources.getByText("Publisher: docs.example.org", { exact: true })).toBeVisible();
});

test("stopping before the first token preserves an honest response with immediate retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let chatRequests = 0;
    const requestTools: unknown[] = [];
    Reflect.defineProperty(window, "__kovaRequestTools", { value: requestTools });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      if (typeof init?.body === "string") requestTools.push(JSON.parse(init.body).clientTool);
      chatRequests += 1;
      if (chatRequests > 1) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"Recovered response"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }

      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"kind":"activity","tool":"search_web","label":"Searching the web","status":"running"}}]}\n\ndata: {"choices":[{"delta":{"kind":"image_pending"}}]}\n\ndata: {"choices":[{"delta":{"content":"Partial response"}}]}\n\n',
              ),
            );
            const abort = () =>
              controller.error(signal?.reason ?? new DOMException("Aborted", "AbortError"));
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const moreTools = page
    .locator("summary")
    .filter({ hasText: /^More tools$/ })
    .filter({ visible: true });
  await expect(moreTools).toBeVisible();
  await moreTools.click();
  await page.getByRole("button", { name: "Search the web" }).click();
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Find a mountain sunset");
  await page.evaluate(() => {
    // Hold buffered text until Stop flushes it, independent of runner speed.
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const held = new Map<number, FrameRequestCallback>();
    let nextId = -1;
    window.requestAnimationFrame = (callback) => {
      const id = nextId--;
      held.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (id < 0) held.delete(id);
      else cancelFrame(id);
    };
    Reflect.defineProperty(window, "__kovaRestoreAnimationFrames", {
      value: () => {
        window.requestAnimationFrame = requestFrame;
        window.cancelAnimationFrame = cancelFrame;
        for (const callback of held.values()) requestFrame(callback);
        held.clear();
      },
    });
  });
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Generating image…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop generating" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { __kovaRestoreAnimationFrames: () => void }
    ).__kovaRestoreAnimationFrames(),
  );

  await expect(page.getByText("Response stopped", { exact: true })).toBeVisible();
  await expect(page.locator(".kova-assistant-message").last()).toContainText("Partial response");
  await expect(page.getByText("Generating image…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Search the web" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry stopped response" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);

  await page.getByRole("button", { name: "Retry stopped response" }).click();
  await expect(page.locator(".kova-assistant-message").last()).toContainText("Recovered response");
  await expect(page.getByText("Response stopped", { exact: true })).toHaveCount(0);
  await expect(page.locator(".kova-user-message")).toHaveCount(1);
  await expect(page.locator(".kova-assistant-message")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __kovaRequestTools: unknown[] }).__kovaRequestTools.slice(),
      ),
    )
    .toEqual(["web_search", "web_search"]);
});

test("a late stopped request cannot clear the streaming state of its retry", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let chatRequests = 0;
    const requestState = { count: 0 };
    Reflect.defineProperty(window, "__kovaChatRequestState", { value: requestState });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      chatRequests += 1;
      requestState.count = chatRequests;
      if (chatRequests === 1) {
        // Model an abort-insensitive auth/preflight wait that settles after Retry starts.
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            window.setTimeout(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"Replacement complete"}}]}\n\ndata: [DONE]\n\n',
                ),
              );
              controller.close();
            }, 3_500);
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Explain this safely");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __kovaChatRequestState: { count: number } })
            .__kovaChatRequestState.count,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Stop generating" }).click();
  await page.getByRole("button", { name: "Retry stopped response" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __kovaChatRequestState: { count: number } })
            .__kovaChatRequestState.count,
      ),
    )
    .toBe(2);

  await page.waitForTimeout(1_800);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await expect(page.locator(".kova-assistant-message").last()).toContainText(
    "Replacement complete",
  );
});

test("a longer first-token wait stays calm, truthful, and stoppable", async ({
  page,
}, testInfo) => {
  await installAuthenticatedFixture(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"kind":"activity","tool":"search_web","label":"Search complete","status":"done"}}]}\n\n',
              ),
            );
            const abort = () =>
              controller.error(signal?.reason ?? new DOMException("Aborted", "AbortError"));
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });

  await page.clock.install();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Work through this carefully");
  await page.getByRole("button", { name: "Send message" }).click();

  const status = page.locator(".kova-thinking-indicator");
  await expect(status).toContainText("Preparing reply…");
  await page
    .locator(".kova-assistant-message details > summary")
    .filter({ hasText: "Activity" })
    .click();
  await expect(page.getByText("Search complete", { exact: true })).toBeVisible();
  await page.clock.runFor(8_000);
  await expect(status).toContainText("Still waiting for the response…");
  await page.clock.runFor(22_000);
  await expect(
    page.getByRole("status").filter({ hasText: "Taking a little longer" }),
  ).toContainText("Taking a little longer…");

  if (testInfo.project.name === "desktop-1440x900") {
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page
      .getByRole("button", { name: /^Open chat / })
      .first()
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Taking a little longer" }),
    ).toContainText("Taking a little longer…");
  }
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await page.getByRole("button", { name: "Stop generating" }).click();
  await expect(page.getByText("Response stopped", { exact: true })).toBeVisible();
});

async function startAttachedConversation(
  page: import("@playwright/test").Page,
  expectedResponse: string,
) {
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "brief.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("topic,status\nlaunch,ready"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Original prompt");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".kova-assistant-message")).toContainText(expectedResponse);
}

test("editing a prompt replaces its turn and keeps attachments", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await fixture(page, "light", true, false);
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
  await page.getByRole("button", { name: "Send message" }).click();

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
  await fixture(page, "light", true, false);
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
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);

  await expect(page.locator(".kova-user-message")).toHaveCount(1);
  await expect(page.locator(".kova-assistant-message")).toContainText("Regenerated response");
  const messages = requestBody?.messages as Array<Record<string, unknown>>;
  expect(messages).toHaveLength(1);
  expect(messages[0].attachments).toEqual([
    expect.objectContaining({ kind: "text_file", name: "brief.csv" }),
  ]);
});

test("archived chats can be removed from Settings data controls", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "kovagpt:archived:v2:user:22222222-2222-4222-8222-222222222222",
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
  await waitForKovaHydration(page);
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await openCurrentSettings(page);
  await chooseSettingsSection(page, "Data control");

  const archived = page.getByRole("region", { name: "Archived chats" });
  await expect(archived).toBeVisible();
  await archived.getByRole("button", { name: "Delete archived chat Archived chat" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Move “Archived chat” to Trash?" });
  await confirmation.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trash", exact: true })).toContainText(
    "Archived chat",
  );
  await expect(archived.getByText("No archived chats", { exact: true })).toBeVisible();
  await page.reload();
  await waitForKovaHydration(page);
  await expect(page.getByRole("region", { name: "Archived chats" })).toContainText(
    "No archived chats",
  );
  await expect(page.getByRole("region", { name: "Trash", exact: true })).toContainText(
    "Archived chat",
  );
  expect(await page.evaluate(() => localStorage.getItem("kovagpt:archived"))).toBeNull();
});
test("signed-out chat cannot start a generation or create history", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/chat", async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Session response"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toHaveCount(0);
  await expect(page.getByTestId("send-button")).toHaveCount(0);
  expect(requests).toBe(0);
  await expect(page.locator(".kova-chat-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat options" })).toHaveCount(0);
});

test("text files are attached as real request context and remain visible in history", async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await fixture(page, "light", true, false);
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
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "quarterly.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("metric,value\nrevenue,42"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByText("quarterly.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("What is the revenue?");
  await page.getByRole("button", { name: "Send message" }).click();

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
