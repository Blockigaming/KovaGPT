import { test, expect } from "@playwright/test";
import { fixture, owner, chatA, functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("a signed-out visitor must choose login or signup", async ({ page }) => {
  await fixture(page, "dark", false);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(0);
});
test("Free has a blue Thinking toggle and Voice switches to Send in a quiet composer", async ({
  page,
}) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(input).toBeEnabled();
  await expect(input).toHaveCSS("font-family", /ui-sans-serif|system-ui|Arial|IBM Plex Sans/);

  const thinking = page.getByRole("button", { name: "Thinking", exact: true });
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "true");
  await expect(thinking).toHaveCSS("color", "rgb(59, 130, 246)");
  await expect(thinking.locator("svg")).toHaveCSS("color", "rgb(59, 130, 246)");
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("voice-button")).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeHidden();
  await input.fill("A draft ready for review");
  await expect(page.getByTestId("send-button")).toBeVisible();
  await expect(page.getByTestId("voice-button")).toBeHidden();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("group", { name: "Chat resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await input.fill("");
  await expect(page.getByTestId("voice-button")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `artifacts/ui-finish-${test.info().project.name}-composer.png`,
    fullPage: true,
  });
});
test("sidebar resizes, customizes, scrolls and matches account popup insets", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024, "Desktop resize control");
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.goto("/");
  await waitForKovaHydration(page);
  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  if (await expand.isVisible()) await expand.click();
  const sidebar = page.locator("#kova-primary-navigation");
  const edge = page.getByRole("separator", { name: "Resize sidebar" });
  await edge.focus();
  await edge.press("ArrowRight");
  await expect(edge).toHaveAttribute("aria-valuenow", "290");
  const box = await edge.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 80);
  await page.mouse.down();
  await page.mouse.move(box!.x + 64, box!.y + 80);
  await page.mouse.up();
  await expect(edge).toHaveAttribute("aria-valuenow", "350");
  await sidebar.getByText("More", { exact: true }).click();
  await sidebar.getByRole("button", { name: "Customize sidebar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Search position").selectOption("navigation");
  await dialog.getByRole("switch", { name: "Images", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Search chats", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Work", exact: true })).toHaveCount(0);
  const trigger = sidebar.getByRole("button", { name: "Account menu" });
  const a = await trigger.boundingBox();
  await trigger.click();
  const menu = page.locator(".kova-profile-menu");
  await expect(menu).toBeVisible();
  const b = await menu.boundingBox();
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
  expect(Math.abs(a!.width - b!.width)).toBeLessThan(2);
});
for (const [tier, limits] of [
  ["free", { regular: 50, thinking: 10, images: 8, uploads: 3 }],
  ["plus", { regular: 250, thinking: 50, images: 40, uploads: 15 }],
  ["pro", { regular: 3750, thinking: 750, images: 600, uploads: 225 }],
] as const)
  test(`${tier} settings display percentages from actual mode-specific usage`, async ({ page }) => {
    await fixture(page, "dark", true, false, tier);
    const usage = {
      chats: Math.floor(limits.regular / 2) + Math.floor(limits.thinking / 5),
      thinking: Math.floor(limits.thinking / 5),
      images: limits.images / 4,
      uploads: limits.uploads,
      resetsAt: "2026-11-02T00:00:00Z",
    };
    await page.route("**/_serverFn/**", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (!functionNames.get(id)?.startsWith("getMyDailyUsage_")) return route.fallback();
      return route.fulfill({ json: { result: usage, context: {} } });
    });
    for (const section of ["usage", "billing"]) {
      await page.goto(`/settings/${section}`);
      await waitForKovaHydration(page);
      for (const [label, percent] of [
        ["Regular messages", 50],
        ["Thinking", 20],
        ["Images", 25],
        ["File uploads", 100],
      ] as const) {
        const bar = page.getByRole("progressbar", { name: `${label} used today`, exact: true });
        await expect(bar).toHaveAttribute("aria-valuemax", "100");
        await expect(bar).toHaveAttribute("aria-valuenow", String(percent));
        await expect(bar).toHaveAttribute("aria-valuetext", `${percent}% used`);
      }
      await expect(page.locator(".kova-plan-usage")).not.toContainText(/\d+\s*\/\s*\d+/);
    }
    await page.screenshot({
      path: `artifacts/ui-finish-${test.info().project.name}-${tier}-usage.png`,
      fullPage: true,
    });
  });
test("five image shapes and Custom keep exact validated dimensions", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.route("**/api/generate-image*", (route) =>
    route.fulfill({
      json: {
        editingEnabled: true,
        images: [],
        aspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16"],
        customSizesSupported: true,
      },
    }),
  );
  await page.goto("/images");
  await waitForKovaHydration(page);
  const shape = page.getByRole("combobox", { name: "Output image shape" });
  await shape.click();
  for (const name of [
    /Square/,
    /Landscape/,
    /Portrait/,
    /Widescreen/,
    /Story/,
    /Custom dimensions/,
  ])
    await expect(page.getByRole("option", { name })).toBeVisible();
  await page.getByRole("option", { name: "Custom dimensions" }).click();
  await expect(page.getByRole("spinbutton", { name: "Image width" })).toHaveValue("1536");
  await expect(page.getByRole("spinbutton", { name: "Image height" })).toHaveValue("864");
  await expect(page.getByRole("button", { name: "Edit an image from Library" })).toBeVisible();
});
test("Share copies a real link and reports clipboard errors without false success", async ({
  page,
}) => {
  await fixture(page, "dark", true, true);
  const token = "a".repeat(64);
  await page.route("**/api/chat-share", (route) =>
    route.fulfill({
      json: {
        id: "33333333-3333-4333-8333-333333333333",
        path: `/share/${token}`,
        expiresAt: "2026-12-01T00:00:00Z",
      },
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Share chat", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Share this conversation" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create & copy link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(
    new URL(`/share/${token}`, page.url()).href,
  );
  await expect(page.getByText("Link copied to clipboard", { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    }),
  );
  await dialog.getByRole("button", { name: "Create & copy link" }).click();
  await expect(page.getByText("Link copied to clipboard", { exact: true })).toBeVisible();
});

for (const [tier, count] of [
  ["plus", 4],
  ["pro", 7],
] as const)
  test(`${tier} exposes exactly its additional model levels`, async ({ page }) => {
    await fixture(page, "dark", true, false, tier);
    await page.goto("/");
    await waitForKovaHydration(page);
    await page.getByTestId("model-selector-trigger").click();
    await expect(page.locator('[data-testid^="model-option-"]')).toHaveCount(count);
    await expect(page.getByTestId("thinking-toggle")).toHaveCount(0);
  });
test("appearance changes save and survive a reload", async ({ page }) => {
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  await page.getByRole("combobox", { name: "Density", exact: true }).click();
  await page.getByRole("option", { name: "Compact", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await waitForKovaHydration(page);
  await expect(page.getByRole("combobox", { name: "Density", exact: true })).toHaveText("Compact");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
  await expect(page.getByText("Appearance reset to defaults.", { exact: true })).toBeVisible();
});

test("the conversation checklist collects sources, outputs and real browser metadata", async ({
  page,
}) => {
  await fixture(page, "dark", true, true, "pro");
  await page.addInitScript(
    ({ owner, chatA }) => {
      const key = `nova-gpt-conversations-v3:user:${owner}`;
      const chats = JSON.parse(localStorage.getItem(key)!);
      const chat = chats.find((row: { id: string }) => row.id === chatA);
      chat.messages[1].content = "Fixture output:\n```js\nconsole.log('review');\n```";
      chat.messages[1].sources = [
        { title: "Example reference", url: "https://example.com/reference", domain: "example.com" },
      ];
      chat.messages[1].memorySources = {
        ownerId: owner,
        sources: [{ kind: "chat_memory", id: "11111111-1111-4111-8111-111111111111" }],
      };
      chat.messages[1].activities = [
        "github_read",
        "supabase_query",
        "firecrawl_scrape",
        "library_search",
        "read_file",
      ].map((tool) => ({ tool, label: tool, status: "done" }));
      localStorage.setItem(key, JSON.stringify(chats));
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/chat")) return originalFetch(input, init);
        return new Response(
          new ReadableStream({
            start(controller) {
              const delta = {
                kind: "activity",
                tool: "browser_interact",
                label: "Fixture browser session",
                status: "running",
                browser: {
                  sessionId: "fixture-session",
                  tabCount: 5,
                  observedAt: Date.now(),
                  url: "https://example.com/reference",
                  previewPath: "/api/browser/preview/fixture-session",
                },
              };
              const frame = `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "Fixture browser session active." } }] })}\n\n`;
              controller.enqueue(new TextEncoder().encode(frame));
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      };
    },
    { owner, chatA },
  );
  await page.route("**/api/browser/preview/fixture-session", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#e9edf4"/><text x="35" y="125" fill="#243246" font-size="24">Fixture browser preview</text></svg>',
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await page
    .getByRole("textbox", { name: "Message KovaGPT", exact: true })
    .fill("Review the browser activity fixture");
  await page.getByTestId("send-button").click();
  await expect(page.getByText("Fixture browser session active.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  const panel = page.locator(".kova-conversation-outputs");
  await expect(panel.getByRole("heading", { name: "Outputs", exact: true })).toBeVisible();
  for (const name of [
    "GitHub",
    "Supabase",
    "Firecrawl",
    "Library",
    "Files",
    "Web search",
    "Memory",
  ])
    await expect(panel.getByText(name, { exact: true })).toBeVisible();
  await expect(panel.getByText("5 tabs", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Current cloud browser preview" })).toBeVisible();
  await page.screenshot({
    path: `artifacts/ui-finish-${test.info().project.name}-checklist.png`,
    fullPage: true,
  });
});

test("Library search and guided help use rounded, usable fields", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.goto("/library");
  await waitForKovaHydration(page);
  const search = page.getByRole("textbox", { name: "Search Library", exact: true });
  await search.fill("A file to find");
  await expect(search).toHaveValue("A file to find");
  await expect(search).toHaveCSS("outline-style", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/help");
  await waitForKovaHydration(page);
  await page.getByText("Find a fix for your setup", { exact: true }).click();
  await page.getByLabel("Help browser", { exact: true }).selectOption("safari-iphone");
  await page.getByLabel("Help connection", { exact: true }).selectOption("offline");
  await expect(page.getByRole("list", { name: "Troubleshooting steps" })).toContainText(
    "Reconnect before sending",
  );
});
