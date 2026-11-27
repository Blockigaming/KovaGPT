import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture, functionNames, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { composerResourceTrigger, openComposerAddMenu, usesSidebarDrawer } from "./current-ui";

async function start(page: Parameters<typeof fixture>[0], empty = false) {
  await fixture(page, "dark", true);
  if (empty)
    await page.route("**/_serverFn/**", (route) => {
      const name =
        functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) ?? "";
      return name.startsWith("listProjects_")
        ? route.fulfill({ json: { result: [], context: {} } })
        : route.fallback();
    });
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeEnabled();
}

async function openResource(
  page: Parameters<typeof fixture>[0],
  name: "Choose project" | "Files" | "Plugins",
) {
  const trigger = await composerResourceTrigger(page, name);
  const inAttachMenu = await trigger.evaluate(
    (element) => !!element.closest(".spec400-attach-menu"),
  );
  await trigger.click();
  return inAttachMenu ? page.getByRole("button", { name: "Attach", exact: true }) : trigger;
}

test("bottom composer keeps controls clear of the rounded edges", async ({ page }) => {
  await fixture(page, "dark", true, false, "plus");
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Ready to check composer spacing."}}]}\n\ndata: [DONE]\n\n',
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Open a conversation");
  await page.getByTestId("send-button").click();
  await expect(page.getByText("Ready to check composer spacing.")).toBeVisible();
  const frame = page.locator('[data-composer-surface="conversation"] .spec400-composer');
  const input = frame.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(input).toBeVisible();

  for (const draft of ["", "A short draft", "First line\nSecond line\nThird line"]) {
    if (draft) await input.fill(draft);
    const geometry = await frame.evaluate((surface) => {
      const frame = surface.getBoundingClientRect();
      const controls = [
        ...surface.querySelectorAll<HTMLElement>("textarea, .spec400-composer-toolbar button"),
      ];
      const visible = controls
        .map((control) => control.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const c = (r: DOMRect) => r.top + r.height / 2;
      return {
        clearance: Math.min(
          ...visible.map((r) =>
            Math.min(
              r.left - frame.left,
              frame.right - r.right,
              r.top - frame.top,
              frame.bottom - r.bottom,
            ),
          ),
        ),
        overlaps: visible.some((a, index) =>
          visible
            .slice(index + 1)
            .some(
              (b) =>
                a.left < b.right - 1 &&
                a.right > b.left + 1 &&
                a.top < b.bottom - 1 &&
                a.bottom > b.top + 1,
            ),
        ),
        inlineOffset:
          getComputedStyle(surface).display === "grid"
            ? Math.abs(c(visible[0]) - c(visible.at(-1)!))
            : 0,
      };
    });
    expect(geometry.clearance).toBeGreaterThanOrEqual(6);
    expect(geometry.overlaps).toBe(false);
    expect(geometry.inlineOffset).toBeLessThanOrEqual(1);
  }
});

test("requested: topbar, prompt insets and exact attachment actions", async ({ page }, info) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(input).toHaveAttribute("placeholder", "Work with KovaGPT");
  const composer = page.locator(".spec400-composer");
  const inset = await composer.evaluate((surface) => {
    const input = surface.querySelector("textarea")!;
    const text = input.getBoundingClientRect();
    const frame = surface.getBoundingClientRect();
    return {
      x: text.x - frame.x + Number.parseFloat(getComputedStyle(input).paddingLeft),
      y: text.y - frame.y,
    };
  });
  const phoneComposer = await page.evaluate(
    () =>
      matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
        .matches,
  );
  const insetComposer = await page.evaluate(
    () =>
      matchMedia("(768px <= width < 1024px) and (height > 500px) and (pointer: coarse)").matches,
  );
  if (phoneComposer) expect(inset.x).toBeCloseTo(19, 0);
  else {
    if (insetComposer) expect(inset.x).toBeGreaterThanOrEqual(19);
    expect(inset.x).toBeLessThanOrEqual(insetComposer ? 26 : 19);
  }
  expect(inset.y).toBeLessThanOrEqual(20);
  if (!(await usesSidebarDrawer(page))) {
    const header = (await page.locator(".kova-desktop-topbar").boundingBox())!;
    expect(header.y).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Open desktop app", exact: true })).toBeVisible();
  }
  await expect(
    page.locator(".kova-composer-tray").getByRole("button", { name: /^(Context|Options)$/ }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("requested-home.png"), animations: "disabled" });
  const menu = await openComposerAddMenu(page);
  const mobile = page.viewportSize()!.width < 1024;
  const buttons = menu.locator(".kova-composer-quick-menu > button");
  await expect(buttons).toHaveCount(mobile ? 8 : 6);
  for (const [index, name] of [
    "Add photos & files",
    "Add from Library",
    "Create an image",
    "Web search",
    "Work in a project",
    "Drawing",
  ].entries())
    await expect(buttons.nth(index)).toContainText(name);
  await expect(menu).toHaveCSS("border-top-width", "0px");
  // Compare the open menu with its live anchor, not the pre-transition composer.
  await expect
    .poll(async () => {
      const menuBox = await menu.boundingBox();
      const composerBox = await composer.boundingBox();
      if (!menuBox || !composerBox) return Infinity;
      return Math.abs(menuBox.width - composerBox.width);
    })
    .toBeLessThan(3);
  await page.screenshot({ path: info.outputPath("requested-menu.png"), animations: "disabled" });
});

test("requested: empty project, plugin and file pickers contain no sample records", async ({
  page,
}) => {
  await start(page, true);
  await openResource(page, "Choose project");
  const projects = page.getByRole("dialog", { name: "Choose project", exact: true });
  await expect(projects.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(projects.getByText("No active projects found.")).toHaveCount(0);
  await expect(projects.getByRole("list")).toHaveCount(0);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    const createProject = projects.getByRole("button", { name: "New project" });
    await createProject.hover();
    await expect(createProject).toHaveCSS("background-color", "rgb(58, 58, 58)");
  }
  await expect(projects.getByRole("button", { name: "Review project", exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(projects).toBeHidden();
  await openResource(page, "Files");
  const files = page.getByRole("dialog", { name: "Choose files", exact: true });
  await expect(files).toContainText("No saved files yet.");
  await expect(files.locator(".kova-composer-library button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(files).toBeHidden();
  await openResource(page, "Plugins");
  const plugins = page.getByRole("dialog", { name: "Choose plugins", exact: true });
  await expect(plugins).toContainText("No connected plugins.");
  await expect(plugins.locator(".kova-composer-plugin")).toHaveCount(0);
  await expect(plugins).not.toContainText("Recommended plugins");
});

test("opening Choose project uses the prefetched list", async ({ page }) => {
  await fixture(page, "dark", true);
  let requests = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const name = functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!);
    if (!name?.startsWith("listProjects_")) return route.fallback();
    requests++;
    await route.fulfill({
      json: {
        result: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Prefetched project",
            role: "owner",
            archived_at: null,
            deletion_requested_at: null,
          },
        ],
        context: {},
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect.poll(() => requests).toBe(1);
  const trigger = await openResource(page, "Choose project");
  const picker = page.getByRole("dialog", { name: "Choose project", exact: true });
  await expect(
    picker.getByRole("button", { name: "Add project Prefetched project" }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect.poll(() => requests).toBe(2);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Keep this project draft");
  await openResource(page, "Choose project");
  await picker.getByRole("button", { name: "Add project Prefetched project" }).click();
  await expect(input).toHaveValue("Keep this project draft");
  await expect(
    page.getByRole("button", { name: "Remove project Prefetched project" }),
  ).toBeVisible();
});

test("requested: connected plugin rows come only from current account status", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.route("**/api/google/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        state: "connected",
        has: { gmail: true, gmailWrite: false, drive: true, calendar: false, calendarWrite: false },
      },
    }),
  );
  await page.route("**/api/integrations/accounts", (route) =>
    route.fulfill({
      json: {
        configuredProviders: [{ id: "notion" }],
        accounts: [
          {
            id: "fixture-notion",
            user_id: owner,
            provider_id: "notion",
            status: "connected",
            granted_scopes: [],
            token_expires_at: null,
            deleted_at: null,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await openResource(page, "Plugins");
  const plugins = page.getByRole("dialog", { name: "Choose plugins", exact: true });
  await expect(plugins.locator(".kova-composer-plugin")).toHaveCount(3);
  for (const name of ["Gmail", "Google Drive", "Notion"])
    await expect(plugins.locator(".kova-composer-plugin").filter({ hasText: name })).toBeVisible();
  await expect(
    plugins.locator(".kova-composer-plugin").filter({ hasText: "Google Calendar" }),
  ).toHaveCount(0);
  await plugins.getByRole("button", { name: "Gmail", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove plugin Gmail" })).toBeVisible();
});

test("requested: drawing supports history, discard, PNG attachments and Excalidraw file exchange", async ({
  page,
}, info) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Review this drawing");
  const menu = await openComposerAddMenu(page);
  await menu.getByRole("button", { name: "Drawing", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Drawing", exact: true });
  const canvas = dialog.getByLabel("Drawing canvas");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Attach drawing", exact: true })).toBeDisabled();
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const box = (await canvas.boundingBox())!;
  const png = () => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const blank = await png();
  if (page.viewportSize()!.width < 1024) {
    const touch = await page.context().newCDPSession(page);
    for (let index = 0; index <= 12; index++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: index === 0 ? "touchStart" : "touchMove",
        touchPoints: [
          {
            x: box.x + box.width * (0.25 + (index * 0.45) / 12),
            y: box.y + box.height * (0.4 + (index * 0.2) / 12),
          },
        ],
      });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
  } else {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();
  }
  const drawn = await png();
  expect(drawn).not.toBe(blank);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await png()).not.toBe(drawn);
  await expect(dialog.getByRole("button", { name: "Attach drawing", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await png()).toBe(drawn);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download Excalidraw file" }).click(),
  ]);
  const sceneFile = download.suggestedFilename();
  expect(sceneFile).toMatch(/^Drawing-.*\.excalidraw$/);
  const scene = await readFile(await download.path());
  expect(JSON.parse(scene.toString())).toMatchObject({
    type: "excalidraw",
    version: 2,
    elements: [{ type: "freedraw", isDeleted: false, points: expect.any(Array) }],
  });
  await dialog.getByRole("button", { name: "Eraser", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Eraser", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "Discard changes?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await png()).toBe(drawn);
  await page.screenshot({ path: info.outputPath("requested-drawing.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Attach drawing", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Inspect Drawing-.*\.png$/ })).toBeVisible();
  await expect(input).toHaveValue("Review this drawing");
  await expect(input).toBeFocused();
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: sceneFile,
    mimeType: "application/octet-stream",
    buffer: scene,
  });
  await expect(
    page.getByRole("button", { name: `Inspect ${sceneFile}.extracted.txt`, exact: true }),
  ).toBeVisible();
});

test("desktop app control opens installation options directly when browser installation is unavailable", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width < 1024, "Desktop control");
  await start(page);
  await page.getByRole("button", { name: "Open desktop app", exact: true }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByRole("link", { name: "Open installed native app" })).toHaveAttribute(
    "href",
    "kovagpt://open",
  );
});

test("slash commands are selectable by keyboard and show the account model menu", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("/");
  const commands = page.getByRole("group", { name: "Chat commands", exact: true });
  await expect(commands.getByRole("button")).toHaveCount(5);
  await input.fill("/model");
  await input.press("Enter");
  const models = page.getByRole("group", { name: "Choose Kova model", exact: true });
  await expect(models.getByRole("button")).toHaveText(["KovaGPT Chat", "KovaGPT Thinking 4.2"]);
  await models.getByRole("button", { name: "KovaGPT Thinking 4.2", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.fill("/study");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: /remove study/i })).toBeVisible();
});

test("empty chat starts Voice inline and keeps the composer visible", async ({ page }) => {
  await start(page);
  let release: () => void = () => {};
  const connecting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/voice", async (route) => {
    await connecting;
    await route
      .fulfill({
        json: { configured: false, conversation: false, stt: false, voices: [] },
      })
      .catch(() => undefined);
  });
  try {
    const button = page.getByTestId("voice-button");
    await expect(button).toBeEnabled();
    await button.click();
    const voice = page.locator("#kova-inline-voice");
    await expect(voice.getByRole("status")).toHaveText("Starting Voice…");
    await expect(page.locator(".kova-empty-chat")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Voice", exact: true })).toHaveCount(0);
    await expect(page.locator("[data-chat-transcript-loading]")).toHaveCount(0);
    await expect(page.getByText("Original", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Stop voice", exact: true }).click();
    await expect(voice).toHaveCount(0);
    await expect(button).toBeFocused();
  } finally {
    release();
  }
});
