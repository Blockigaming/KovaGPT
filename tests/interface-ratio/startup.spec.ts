import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { chatA, chatB, fixture, owner } from "../e2e/actual-app-fixture";
import { dismissMobileSidebar, openComposerAddMenu, revealSidebar } from "../e2e/current-ui";
import { waitForKovaHydration } from "../e2e/hydration";

async function frame(shell: Locator) {
  const header = shell.locator(".kova-topbar:visible");
  await expect(header).toHaveCount(1);
  return {
    header: (await header.boundingBox())!,
    heading: (await shell.locator(".kova-greeting h1").boundingBox())!,
    composer: (await shell.locator(".spec400-composer").boundingBox())!,
  };
}

type HomeFrame = Awaited<ReturnType<typeof frame>>;

const appShell = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.kovaSurface === "app");

function checkOpeningLayout(
  first: HomeFrame,
  { width, height }: { width: number; height: number },
  appShell: boolean,
) {
  if (width >= 768) return;
  expect(first.composer.width).toBeCloseTo(width - 24, 0);
  void appShell;
  expect(height - first.composer.y - first.composer.height).toBeLessThanOrEqual(24);
  // The greeting sits at the middle height of the screen.
  const center = first.heading.y + first.heading.height / 2;
  expect(Math.abs(center - height / 2)).toBeLessThanOrEqual(8);
}

function compare(first: HomeFrame, next: HomeFrame, phase: string) {
  for (const surface of ["header", "composer"] as const)
    for (const edge of ["x", "y", "width", "height"] as const)
      expect(
        Math.abs(first[surface][edge] - next[surface][edge]),
        `${surface} ${edge} during ${phase}`,
      ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      first.heading.y + first.heading.height / 2 - (next.heading.y + next.heading.height / 2),
    ),
    `greeting position during ${phase}`,
  ).toBeLessThanOrEqual(2);
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: the server paints the phone frame without changing larger viewports`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true, false, "plus");
    const pending = page.locator("[data-kova-home-startup]");
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await page.route("**/*", (route) =>
      route.request().resourceType() === "script" ? route.abort() : route.fallback(),
    );
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "pending");
    await expect(input).toHaveCount(0);
    if (/^(phone|landscape)-/.test(info.project.name)) {
      await expect(pending).toBeVisible();
      await expect(pending).toHaveAttribute("inert", "");
      await page.evaluate(() => document.fonts.ready);
      checkOpeningLayout(await frame(pending), page.viewportSize()!, await appShell(page));
    } else {
      await expect(pending).toBeHidden();
      await expect(page.locator("dialog[data-kova-entry-pending]")).toBeHidden();
    }
  });

  // Use a fresh browser profile for successful loading. A previously aborted
  // module request can persist through reload in WebKit.
  for (const tier of ["free", "plus"] as const) {
    test(`${theme} ${tier}: the home frame stays in place through account readiness and reload`, async ({
      page,
    }, info) => {
      await fixture(page, theme, true, false, tier, { preserveStorageOnReload: true });
      const viewport = page.viewportSize()!;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const pending = page.locator("[data-kova-home-startup]");
      const ready = page.locator(".kova-assistant[data-ui='modern']:not([data-kova-home-startup])");
      const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
      const entryDialog = page.locator("dialog[data-kova-entry-pending]");
      const phone = /^(phone|landscape)-/.test(info.project.name);
      const capture = tier === "plus" && ["desktop-1440", "phone-390"].includes(info.project.name);

      for (const visit of ["first interactive load", "reload"]) {
        let release!: () => void;
        const account = new Promise<void>((resolve) => (release = resolve));
        const holdAccount = async (route: Route) => {
          await account;
          await route.fallback();
        };
        await page.route("**/auth/v1/user", holdAccount);
        let first: HomeFrame | undefined;
        try {
          if (visit === "reload") await page.reload({ waitUntil: "load" });
          else await page.goto("/", { waitUntil: "load" });
          await waitForKovaHydration(page);
          await expect(entryDialog).toHaveAttribute("open", "");
          await expect(input).toHaveCount(0);
          if (phone) {
            await expect(pending).toBeVisible();
            await expect(entryDialog).toHaveCSS("outline-style", "none");
            await page.evaluate(() => document.fonts.ready);
            first = await frame(pending);
            checkOpeningLayout(first, viewport, await appShell(page));
          } else {
            await expect(pending).toBeHidden();
            await expect(entryDialog.locator("[data-kova-entry-fallback]")).toBeVisible();
          }
          if (capture && visit === "first interactive load")
            await page.screenshot({ path: info.outputPath("before-interactive.png") });
        } finally {
          release();
          await page.unroute("**/auth/v1/user", holdAccount);
        }

        await expect(input).toBeEnabled();
        await expect(pending).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        if (phone) await expect(input).toBeFocused();
        else await expect(input).not.toBeFocused();
        if (first) {
          const startupFrame = first;
          await expect(async () => compare(startupFrame, await frame(ready), visit)).toPass({
            timeout: 5_000,
          });
        }
        if (capture && visit === "first interactive load")
          await page.screenshot({ path: info.outputPath("ready.png") });
        await input.fill("Draft typed after startup");
        await expect(input).toHaveValue("Draft typed after startup");
        await input.fill("");
      }
      expect(errors).toEqual([]);
    });
  }
}

test("dark: recommendations and tools open from a clear phone chat", async ({ page }, info) => {
  test.skip(
    info.project.name === "desktop-1440" || info.project.name === "tablet-768",
    "phone layout",
  );
  await fixture(page, "dark", true, false, "plus");
  const timestamp = Date.now();
  const records = [chatA, chatB].map((id, index) => ({
    id,
    revision: 1,
    sync_version: index + 1,
    mutation_id: crypto.randomUUID(),
    archived: false,
    deleted_at: null,
    payload: {
      id,
      title: index ? "Second review chat" : "Composer review chat",
      mode: "instant",
      createdAt: timestamp,
      updatedAt: timestamp + index,
      messages: [
        { id: "prompt-a", role: "user", content: "Draft a release checklist." },
        { id: "answer-a", role: "assistant", content: "Review the draft before publishing." },
      ],
    },
  }));
  await page.route("**/api/chat/history**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const cursor = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
    const next = records.find((record) => record.sync_version > cursor);
    const nextCursor = next?.sync_version ?? cursor;
    return route.fulfill({
      json: {
        ownerId: owner,
        epoch: "44444444-4444-4444-8444-444444444444",
        records: next ? [next] : [],
        nextCursor,
        currentVersion: records.length,
        hasMore: nextCursor < records.length,
      },
    });
  });
  await page.goto("/", { waitUntil: "load" });
  await waitForKovaHydration(page);
  const shell = page.locator(".kova-assistant[data-ui='modern']:not([data-kova-home-startup])");
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(input).toBeEnabled();
  const homeRecommendations = shell.locator(".kova-empty-chat .spec400-recent-work");
  await expect(homeRecommendations).toBeAttached();
  await expect(homeRecommendations).toBeHidden();
  await expect(shell.locator(".kova-sidebar")).toHaveAttribute("data-state", "closed");
  await page.evaluate(() => document.fonts.ready);
  const opening = await frame(shell);
  checkOpeningLayout(opening, page.viewportSize()!, await appShell(page));
  const capture = info.project.name === "phone-390" && !process.env.KOVA_MOBILE_STATE_ENGINE;
  const menu = await openComposerAddMenu(page);
  await expect(menu.getByRole("button", { name: "Choose project", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Plugins", exact: true })).toBeVisible();
  if (capture)
    await page.screenshot({ path: info.outputPath("composer-menu.png"), animations: "disabled" });
  for (const [name, label] of [
    ["Files", "Choose files"],
    ["Plugins", "Choose plugins"],
  ]) {
    await menu.getByRole("button", { name, exact: true }).click();
    const back = page
      .getByRole("dialog", { name: label, exact: true })
      .getByRole("button", { name: "Back to files and tools" });
    await expect(back).toBeFocused();
    await back.click();
    await expect(menu.getByRole("button", { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const drawer = await revealSidebar(page);
  const recent = drawer.getByRole("region", { name: "Continue working", exact: true });
  await expect(recent).toHaveCount(0);
  if (capture)
    await page.screenshot({ path: info.outputPath("navigation.png"), animations: "disabled" });
  await dismissMobileSidebar(page);
  compare(opening, await frame(shell), "closing the drawer");
  await revealSidebar(page);
  await drawer
    .getByRole("region", { name: "Chats", exact: true })
    .getByRole("button", { name: "Open chat Composer review chat", exact: true })
    .click();
  await expect(page.locator("#message-answer-a")).toBeVisible();
  await expect(drawer).toBeHidden();
  await expect(input).not.toBeFocused();
  if (capture)
    await page.screenshot({ path: info.outputPath("conversation.png"), animations: "disabled" });
});
