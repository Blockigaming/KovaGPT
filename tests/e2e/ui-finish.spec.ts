import { test, expect } from "@playwright/test";
import { fixture, owner, chatA, planUsageFixture } from "./actual-app-fixture";
import { resolveFixtureFunctionName } from "./server-function-fixture";
import { waitForKovaHydration } from "./hydration";
import { composerResourceTrigger, usesSidebarDrawer } from "./current-ui";
import { CHAT_USAGE_WINDOWS } from "../../src/lib/plan-usage-policy.mjs";

test("a signed-out visitor must choose login or signup", async ({ page }) => {
  await fixture(page, "dark", false);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("button", { name: "Continue with email", exact: true }),
  ).toBeVisible();
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
  const files = await composerResourceTrigger(page, "Files");
  await expect(files).toBeVisible();
  await files.click();
  await expect(page.getByRole("dialog", { name: "Choose files", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await input.fill("");
  await expect(page.getByTestId("voice-button")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `artifacts/ui-finish-${test.info().project.name}-composer.png`,
    fullPage: true,
  });
});
test("sidebar resizes, customizes, scrolls and matches account popup insets", async ({ page }) => {
  test.skip(await usesSidebarDrawer(page), "Desktop resize control");
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
  await expect(dialog.getByRole("switch", { name: "Images", exact: true })).toHaveCount(0);
  await dialog.getByRole("switch", { name: "Projects", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Search chats", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Work", exact: true })).toHaveCount(0);
  const trigger = sidebar.getByRole("button", { name: "Account menu" });
  const a = await trigger.boundingBox();
  await trigger.click();
  const menu = page.locator(".kova-profile-menu");
  await expect(menu).toBeVisible();
  const b = await menu.boundingBox();
  // The account popup stays within the sidebar account row.
  const viewport = page.viewportSize()!;
  expect(b!.width).toBeGreaterThanOrEqual(Math.min(a!.width, viewport.width - 24) - 2);
  expect(b!.width).toBeLessThanOrEqual(a!.width + 1);
  expect(b!.x).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width).toBeLessThanOrEqual(viewport.width + 1);
});
test("desktop profile Help opens beside the sidebar at the account menu height", async ({
  page,
}) => {
  test.skip(await usesSidebarDrawer(page), "Desktop submenu");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  if (await expand.isVisible()) await expand.click();
  const sidebar = page.locator("#kova-primary-navigation");
  await sidebar.getByRole("button", { name: "Account menu", exact: true }).click();
  const account = page.locator(".kova-profile-menu");
  const help = account.getByRole("menuitem", { name: "Help", exact: true });
  await help.click();
  const submenu = page.getByRole("menu", { name: "Help", exact: true });
  await expect(submenu.getByRole("menuitem")).toHaveCount(8);
  await expect
    .poll(async () => {
      const parent = (await account.boundingBox())!;
      const flyout = (await submenu.boundingBox())!;
      return Math.abs(parent.height - flyout.height);
    })
    .toBeLessThanOrEqual(1);
  const parent = (await account.boundingBox())!;
  const flyout = (await submenu.boundingBox())!;
  const edge = (await sidebar.boundingBox())!;
  const button = (await help.boundingBox())!;
  const idealTop = button.y + (button.height - flyout.height) / 2;
  const clampedTop = Math.max(
    8,
    Math.min(idealTop, page.viewportSize()!.height - 8 - flyout.height),
  );
  expect(flyout.x).toBeGreaterThanOrEqual(Math.max(parent.x + parent.width, edge.x + edge.width));
  expect(Math.abs(clampedTop - flyout.y)).toBeLessThanOrEqual(2);
  await submenu.getByRole("menuitem", { name: "Release notes" }).click();
  await expect(page).toHaveURL(/\/changelog$/);
});

for (const tier of ["free", "plus", "pro"] as const)
  test(`${tier} settings display percentages from metered API cost`, async ({ page }) => {
    await fixture(page, "dark", true, false, tier);
    const windows = planUsageFixture(tier).windows.map((window) => ({
      ...window,
      regularUsed: Math.floor(window.regularLimit / 2),
      thinkingUsed: Math.floor(window.thinkingLimit / 5),
      ...(tier === "free" && window.id === "five_hour"
        ? { fixedWindow: true as const, costPercentUsed: 3 }
        : { costPercentUsed: 10 }),
    }));
    const usage = { tier, windows, images: 2, uploads: 1 };
    await page.route("**/_serverFn/**", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (!resolveFixtureFunctionName(id)?.startsWith("getMyPlanUsage_")) return route.fallback();
      return route.fulfill({ json: { result: usage, context: {} } });
    });
    for (const section of ["usage", "billing"]) {
      await page.goto(`/settings/${section}`);
      await waitForKovaHydration(page);
      await expect(page.getByRole("progressbar")).toHaveCount(windows.length);
      for (const { id, costPercentUsed, fixedWindow } of windows) {
        const bar = page.getByRole("progressbar", {
          name: `${CHAT_USAGE_WINDOWS[id]} chat usage`,
          exact: true,
        });
        await expect(bar).toHaveAttribute("aria-valuemax", "100");
        await expect(bar).toHaveAttribute("aria-valuenow", String(costPercentUsed));
        if (id === "five_hour") {
          const row = page.locator(".kova-plan-usage-row").filter({ has: bar });
          await expect(
            row.getByText(fixedWindow ? /^Resets / : /^Next hourly refresh /),
          ).toBeVisible();
        }
      }
      await expect(page.locator(".kova-plan-usage")).not.toContainText(
        /Today’s images|Some chat usage data|Usage percentages are estimates/,
      );
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
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard blocked");
        },
      },
    }),
  );
  const token = "a".repeat(64);
  let creates = 0;
  await page.route("**/api/chat-share", (route) => {
    if (route.request().method() === "POST") creates++;
    return route.fulfill({
      json: {
        id: "33333333-3333-4333-8333-333333333333",
        path: `/share/${token}`,
        expiresAt: "2026-12-01T00:00:00Z",
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Share chat", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Copy public link" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(
    new URL(`/share/${token}`, page.url()).href,
  );
  await expect(dialog.getByRole("alert")).toHaveText(
    "Copy failed. Select the link below to copy it manually.",
  );
  await expect(
    page.getByRole("dialog", { name: "Public view-only link copied", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { copiedShareLink?: string }).copiedShareLink = value;
        },
      },
    }),
  );
  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Public link copied", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => (window as Window & { copiedShareLink?: string }).copiedShareLink),
  ).toBe(new URL(`/share/${token}`, page.url()).href);
  expect(creates).toBe(1);
});

for (const [tier, maxIndex, highest] of [
  ["plus", 4, "Max"],
  ["pro", 5, "Ultra"],
] as const)
  test(`${tier} exposes exactly its additional model levels`, async ({ page }) => {
    await fixture(page, "dark", true, false, tier);
    await page.goto("/");
    await waitForKovaHydration(page);
    await page.getByTestId("model-selector-trigger").click();
    const slider = page.getByRole("slider", { name: "Response effort", exact: true });
    await expect(slider).toHaveAttribute("max", String(maxIndex));
    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", highest);
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
  // Settings deep links are consumed when opening the modal. A full reload
  // restores the workspace, so reopen the section to inspect saved preferences.
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.goto("/settings/appearance");
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
      chat.title = "YouTube research · example";
      chat.messages[0].content =
        "Use YouTube to plan a short video edit. Use my notes and draft two outputs.";
      chat.messages[0].attachments = [
        { kind: "text_file", name: "Video brief.txt", content: "Make a short editing tutorial." },
        {
          kind: "text_file",
          name: "Shot list.txt",
          content: "Opening shot, screen capture, final cut.",
        },
      ];
      chat.messages[1].content =
        "I prepared an editing checklist and a shot schedule.\n\n```kova-docx\n# Editing checklist\nTrim the opening and add captions.\n```\n\n```kova-xlsx\n# Shot schedule\n| Shot | Duration |\n| --- | --- |\n| Intro | 5 seconds |\n```";
      chat.messages[1].sources = [
        { title: "Example reference", url: "https://example.com/reference", domain: "example.com" },
      ];
      chat.messages[1].memorySources = {
        ownerId: owner,
        sources: [{ kind: "chat_memory", id: "11111111-1111-4111-8111-111111111111" }],
      };
      chat.messages[1].activities = [
        ["github_read", "Checked the project repository"],
        ["supabase_query", "Looked up the project record"],
        ["firecrawl_scrape", "Read the reference page"],
        ["library_search", "Found the editing template"],
        ["read_file", "Reviewed the video brief"],
      ].map(([tool, label]) => ({ tool, label, status: "done" }));
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
                label: "Browsing YouTube",
                status: "running",
                browser: {
                  sessionId: "d840146b-ab21-4a1a-8c68-9621ea1e11f2",
                  tabCount: 1,
                  observedAt: Date.now(),
                  url: "https://www.youtube.com/",
                  previewPath: "/api/browser/preview/d840146b-ab21-4a1a-8c68-9621ea1e11f2",
                },
              };
              const frame = `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "YouTube is open in Cloud Browser. This chat uses sample files and outputs." } }] })}\n\n`;
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
  const browserCommands: string[] = [];
  const frameImage = (await page.screenshot({ type: "jpeg" })).toString("base64");
  await page.route("**/api/browser/preview/d840146b-ab21-4a1a-8c68-9621ea1e11f2", (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON();
      browserCommands.push(action.kind);
      return route.fulfill({
        json: {
          frame:
            action.kind === "release"
              ? null
              : {
                  id: "75361397-312d-4be8-8123-9f6de919b17a",
                  jpeg: frameImage,
                  width: action.width ?? 840,
                  height: action.height ?? 540,
                },
        },
      });
    }
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
        <rect width="400" height="240" fill="#0f0f0f"/>
        <rect x="16" y="17" width="35" height="24" rx="7" fill="#ff0033"/>
        <path fill="#fff" d="M30 23l12 6-12 6z"/>
        <text x="58" y="36" fill="#fff" font-family="sans-serif" font-size="22" font-weight="bold">YouTube</text>
        <rect x="172" y="17" width="211" height="24" rx="12" fill="#282828"/>
        <text x="185" y="33" fill="#aaa" font-family="sans-serif" font-size="12">Search</text>
        <rect x="16" y="61" width="171" height="83" rx="8" fill="#35476f"/>
        <rect x="202" y="61" width="181" height="83" rx="8" fill="#812c49"/>
        <path d="M85 83l31 19-31 20zM277 83l31 19-31 20z" fill="#fff"/>
        <text x="16" y="164" fill="#fff" font-family="sans-serif" font-size="14">Editing basics</text>
        <text x="202" y="164" fill="#fff" font-family="sans-serif" font-size="14">Short-form video tips</text>
        <path d="M16 188h171v37H16zM202 188h181v37H202z" fill="#272727"/>
      </svg>`,
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await page
    .getByRole("textbox", { name: "Message KovaGPT", exact: true })
    .fill("Open YouTube in Cloud Browser.");
  await page.getByTestId("send-button").click();
  await expect(
    page.getByText("YouTube is open in Cloud Browser. This chat uses sample files and outputs.", {
      exact: true,
    }),
  ).toBeVisible();
  const previewRequest = page.waitForRequest(
    "**/api/browser/preview/d840146b-ab21-4a1a-8c68-9621ea1e11f2",
  );
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  expect((await previewRequest).headers()["x-kova-owner"]).toBe(owner);
  const panel = page.locator(".kova-conversation-outputs");
  const [outputs, inputs, sources] = ["Outputs", "Inputs", "Sources"].map((name) =>
    panel.getByRole("region", { name, exact: true }),
  );
  const sections = [
    {
      name: "Outputs",
      region: outputs,
      row: outputs.getByRole("button", { name: /Editing checklist/ }),
    },
    {
      name: "Inputs",
      region: inputs,
      row: inputs.getByRole("button", { name: /Video brief.txt/ }),
    },
    {
      name: "Sources",
      region: sources,
      row: sources.getByRole("button", { name: /Open browser activity/ }),
    },
  ];
  for (const { name, region, row } of sections) {
    const toggle = region.getByRole("button", { name, exact: true });
    const arrow = toggle.locator(".kova-activity-chevron");
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
      await toggle.hover();
    }
    await expect(arrow).toHaveCSS("opacity", "1");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const controlledId = await toggle.getAttribute("aria-controls");
    await expect(region.locator(`[id="${controlledId}"]`)).toBeVisible();
    await arrow.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(row).toBeHidden();
    for (const other of sections.filter((entry) => entry.name !== name)) {
      await expect(other.row).toBeVisible();
    }
    await expect(arrow).toHaveCSS("opacity", "1");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(row).toBeVisible();
  }
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
  const browser = panel
    .getByRole("region", { name: "Sources", exact: true })
    .getByRole("group", { name: "Cloud browser", exact: true });
  await expect(browser).toContainText("Active");
  await expect(browser).toContainText("www.youtube.com");
  await expect(browser).toContainText("1 tab");
  await expect(panel.getByRole("button", { name: /Editing checklist/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Shot schedule/ })).toBeVisible();
  await expect(inputs.getByText("Video brief.txt", { exact: true })).toBeVisible();
  await expect(inputs.getByText("Shot list.txt", { exact: true })).toBeVisible();
  await expect(sources.getByText("Shot list.txt", { exact: true })).toHaveCount(0);
  const preview = browser.getByRole("img", { name: "Current cloud browser preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(400);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await panel.getByText("Browsing YouTube", { exact: true }).click();
    await sources.getByRole("button", { name: "Sources", exact: true }).hover();
  }
  await page.screenshot({
    path: `artifacts/ui-finish-${test.info().project.name}-checklist.png`,
    fullPage: true,
  });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 470 });
  const scrollBody = await panel.evaluateHandle((element) => {
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === "auto") return parent;
    }
    throw new Error("Activity has no scroll container");
  });
  await expect
    .poll(() => scrollBody.evaluate((body) => body.scrollHeight - body.clientHeight))
    .toBeGreaterThan(0);
  await scrollBody.evaluate((body) => (body.scrollTop = 0));
  const scrollBounds = await scrollBody.asElement().boundingBox();
  expect(scrollBounds).not.toBeNull();
  await page.mouse.move(
    scrollBounds!.x + scrollBounds!.width / 2,
    scrollBounds!.y + scrollBounds!.height / 2,
  );
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => scrollBody.evaluate((body) => body.scrollTop)).toBeGreaterThan(0);
  await expect(panel.getByText("Memory", { exact: true })).toBeInViewport();
  await page.setViewportSize(viewport);
  await browser.getByRole("button", { name: /Open browser activity/ }).click();
  const workspace = page.getByRole("dialog", { name: "Cloud browser", exact: true });
  await expect(workspace.getByRole("img", { name: "Current cloud browser preview" })).toBeVisible();
  const bounds = await workspace.boundingBox();
  const main = await page.locator(".kova-chat-main").boundingBox();
  expect(bounds).not.toBeNull();
  expect(main).not.toBeNull();
  expect(bounds!.x).toBeCloseTo(main!.x, 0);
  expect(bounds!.width).toBeCloseTo(main!.width, 0);
  expect(bounds!.y + bounds!.height).toBeCloseTo(main!.y + main!.height, 0);
  await workspace.getByRole("button", { name: "Take over", exact: true }).click();
  const screen = workspace.getByRole("img", { name: "Live browser page" });
  await expect(screen).toBeVisible();
  const picture = (await screen.boundingBox())!;
  expect(picture.y).toBeCloseTo(bounds!.y, 0);
  expect(picture.width).toBeCloseTo(bounds!.width, 0);
  expect(picture.height).toBeCloseTo(bounds!.height, 0);
  await screen.click();
  await expect.poll(() => browserCommands).toContain("click");
  await workspace.getByRole("button", { name: "Return control", exact: true }).click();
  await expect.poll(() => browserCommands).toContain("release");
  await expect(workspace).toBeHidden();
  await expect(page.getByRole("button", { name: "Activity", exact: true })).toBeFocused();
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
