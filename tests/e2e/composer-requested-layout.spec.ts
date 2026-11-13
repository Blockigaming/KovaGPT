import { test, expect } from "@playwright/test";
import { fixture, functionNames, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { openComposerAddMenu } from "./current-ui";

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

test("requested: topbar, prompt insets and exact attachment actions", async ({ page }, info) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(input).toHaveAttribute("placeholder", "Work with KovaGPT");
  const composer = page.locator(".spec400-composer");
  const box = (await composer.boundingBox())!;
  const text = (await input.boundingBox())!;
  expect(text.x - box.x).toBeLessThanOrEqual(18);
  expect(text.y - box.y).toBeLessThanOrEqual(20);
  if (page.viewportSize()!.width >= 1024) {
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
  await expect
    .poll(async () => Math.abs((await menu.boundingBox())!.width - box.width))
    .toBeLessThan(3);
  await page.screenshot({ path: info.outputPath("requested-menu.png"), animations: "disabled" });
});

test("requested: empty project, plugin and file pickers contain no sample records", async ({
  page,
}) => {
  await start(page, true);
  const tray = page.locator(".kova-composer-tray");
  await tray.getByRole("button", { name: "Choose project", exact: true }).click();
  const projects = page.getByRole("dialog", { name: "Choose project", exact: true });
  await expect(projects).toContainText("No active projects found.");
  await expect(projects.getByRole("button", { name: "Review project", exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await tray.getByRole("button", { name: "Files", exact: true }).click();
  const files = page.getByRole("dialog", { name: "Choose files", exact: true });
  await expect(files).toContainText("No saved files yet.");
  await expect(files.locator(".kova-composer-library button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await tray.getByRole("button", { name: "Plugins", exact: true }).click();
  const plugins = page.getByRole("dialog", { name: "Choose plugins", exact: true });
  await expect(plugins).toContainText("No connected plugins.");
  await expect(plugins.locator(".kova-composer-plugin")).toHaveCount(0);
  await expect(plugins).not.toContainText("Recommended plugins");
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
  await page
    .locator(".kova-composer-tray")
    .getByRole("button", { name: "Plugins", exact: true })
    .click();
  const plugins = page.getByRole("dialog", { name: "Choose plugins", exact: true });
  await expect(plugins.locator(".kova-composer-plugin")).toHaveCount(3);
  for (const name of ["Gmail", "Google Drive", "Notion"])
    await expect(plugins.locator(".kova-composer-plugin").filter({ hasText: name })).toBeVisible();
  await expect(
    plugins.locator(".kova-composer-plugin").filter({ hasText: "Google Calendar" }),
  ).toHaveCount(0);
});

test("requested: drawing supports pen, undo, redo, eraser, discard and PNG attachment", async ({
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
});

test("requested: desktop app control offers an installed-app link and honest installation fallback", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width < 1024, "Desktop control");
  await start(page);
  await page.getByRole("button", { name: "Open desktop app", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "KovaGPT on your desktop", exact: true });
  await expect(dialog.getByRole("link", { name: "Open installed desktop app" })).toHaveAttribute(
    "href",
    "kovagpt://open",
  );
  await expect(dialog.getByRole("link", { name: "See installation options" })).toHaveAttribute(
    "href",
    "/download",
  );
  await expect(dialog).toContainText("when released");
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

test("desktop draft selection opens formatting controls and applies the chosen style", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width < 1024, "Formatting toolbar is desktop-only.");
  await start(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Format this draft");
  await input.evaluate((element: HTMLTextAreaElement) => element.select());
  const toolbar = page.getByRole("group", { name: "Format selected draft text" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Text", exact: true }).click();
  await toolbar.getByRole("button", { name: "Heading 2" }).click();
  await expect(input).toHaveValue("## Format this draft");
  await expect(toolbar).toBeHidden();
  await expect(input).toBeFocused();
});
