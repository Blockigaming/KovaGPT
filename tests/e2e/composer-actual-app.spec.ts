import { expect, test, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";
import { coreFixture } from "./core-app-fixture";
import {
  openResponseOptions,
  revealSidebar,
  openCurrentSettings,
  chooseSettingsSection,
} from "./current-ui";
import { fixture, functionNames, owner, chatA } from "./actual-app-fixture";

async function geometry(page: Page) {
  const composer = page.locator(".spec400-composer");
  await expect(composer).toHaveCSS("border-radius", "26px");
  const coarseLayout = await page.evaluate(
    () => innerWidth < 1024 || matchMedia("(any-pointer: coarse)").matches,
  );
  const targetSize = coarseLayout ? 44 : 36;
  const send = composer.getByTestId("send-button");
  const voice = composer.getByTestId("voice-button");
  const hasDraft = (await composer.getAttribute("data-has-draft")) === "true";
  const primary = hasDraft ? send : voice;
  await expect(primary).toBeVisible();
  await expect(hasDraft ? voice : send).toBeHidden();
  for (const button of [
    composer.getByRole("button", { name: "Attach", exact: true }),
    composer.getByRole("button", { name: "Type with voice", exact: true }),
    primary,
  ]) {
    await expect(button).toBeVisible();
    await expect.poll(async () => (await button.boundingBox())?.width).toBe(targetSize);
    await expect.poll(async () => (await button.boundingBox())?.height).toBe(targetSize);
  }
  // Writing stays above the toolbar at every viewport, including multiline drafts.
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const input = node.querySelector("textarea")!.getBoundingClientRect();
        const attach = node.querySelector('[aria-label="Attach"]')!.getBoundingClientRect();
        return {
          display: getComputedStyle(node).display === "flex",
          height: node.getBoundingClientRect().height >= 128,
          alignment: input.bottom <= attach.top + 1,
        };
      }),
    )
    .toEqual({ display: true, height: true, alignment: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("signed-in Add menu uses one scroll region in a short desktop viewport", async ({
  page,
}, info) => {
  test.skip(page.viewportSize()!.width < 768, "Desktop Popover regression; phones use a sheet.");
  await page.setViewportSize({ width: 1180, height: 757 });
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const trigger = page.getByRole("button", { name: "Attach", exact: true });
  const menu = page.getByRole("dialog", { name: "Attach files and tools", exact: true });
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Keep this draft");
  const coarsePointer = await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches);
  const attachmentActions = [
    "Library",
    "Files",
    "Open a project",
    "Search the web",
    "Analyze data",
    "Analyze files",
    "Tasks and audio",
    "Drawings",
    "Create Image",
  ];

  async function expectViewportBounds() {
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(12);
    expect(box!.y + box!.height).toBeLessThanOrEqual(745);
  }

  for (let opening = 0; opening < 2; opening++) {
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("data-side", /^(top|bottom)$/);
    await page.keyboard.press("Home");
    await expect(menu.getByRole("button", { name: "Files", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.locator("summary").filter({ hasText: /^More tools$/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("button", { name: "Files", exact: true })).toBeFocused();
    await menu
      .locator("summary")
      .filter({ hasText: /^Plugins$/ })
      .click();
    await menu
      .locator("summary")
      .filter({ hasText: /^More tools$/ })
      .click();
    await expectViewportBounds();
    await expect
      .poll(() =>
        menu.evaluate((element) =>
          element.getAnimations().every((animation) => animation.playState !== "running"),
        ),
      )
      .toBe(true);
    await expectViewportBounds();
    expect(
      await menu.evaluate((element) =>
        [element, ...element.querySelectorAll<HTMLElement>("*")]
          .filter(
            (node) =>
              /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) &&
              node.scrollHeight > node.clientHeight + 1,
          )
          .map((node) => node === element),
      ),
    ).toEqual([true]);
    for (const name of attachmentActions) {
      const action = menu.getByRole("button", { name, exact: true });
      await action.evaluate((element) =>
        element.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      await expect(action).toBeInViewport({ ratio: 1 });
      if (coarsePointer) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if (opening === 0)
      await page.screenshot({
        path: info.outputPath("signed-in-add-menu-initial.png"),
        animations: "disabled",
      });

    const controls = menu
      .locator("button:not(:disabled),a[href],summary")
      .filter({ visible: true });
    await page.keyboard.press("End");
    await expect(controls.last()).toBeFocused();
    await expect(controls.last()).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Home");
    for (let index = 0; index < (await controls.count()); index++) {
      await expect(controls.nth(index)).toBeFocused();
      await expect(controls.nth(index)).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue("Keep this draft");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: empty composer, menus, files and focus`, async ({ page }, info) => {
    await fixture(page, theme);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(input).toBeEnabled();
    await geometry(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: info.outputPath(`home-empty-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await input.click();
    await expect(page.locator(".spec400-composer")).toHaveCSS("outline-style", "none");
    await page.getByRole("button", { name: "Expand input", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await expect(page.locator(".spec400-composer")).toHaveCSS("outline-style", "none");
    await input.fill("Plan a thoughtful product launch");
    await input.press("Shift+Enter");
    await input.pressSequentially("Keep the next steps clear.");
    await expect(input).toHaveValue("Plan a thoughtful product launch\nKeep the next steps clear.");
    await page.screenshot({
      path: info.outputPath(`home-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    const menu = page.getByRole("dialog", {
      name: /^(Attach files and tools|Attach to your message|Attach)$/,
    });
    await expect(menu).toBeVisible();
    if (page.viewportSize()!.width < 768) {
      for (const name of ["Photos", "Camera", "Files"])
        await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await page.screenshot({
      path: info.outputPath(`add-menu-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Draft notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic draft attachment."),
    });
    await expect(page.getByLabel("Remove Draft notes.txt", { exact: true })).toBeVisible();
    const contextButton = page.getByRole("button", { name: "Context", exact: true });
    const attach = page.getByRole("button", { name: "Attach", exact: true });
    const contextInAttach = !(await contextButton.isVisible());
    if (contextInAttach) {
      await attach.click();
      await page
        .locator("summary")
        .filter({ hasText: /^More tools$/ })
        .filter({ visible: true })
        .click();
    }
    await contextButton.click();
    const settings = page.getByRole("dialog", { name: "Context", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByText("Draft notes.txt", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(contextInAttach ? attach : contextButton).toBeFocused();
    await expect(input).toHaveValue(/Plan a thoughtful product launch/);
  });

  test(`${theme}: saved conversation preserves edit drafts and clipboard fallback`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true, true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();
    await geometry(page);
    await input.fill("My unsent follow-up");
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Keep.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep this local draft."),
    });
    await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit message", exact: true }).click();
    await expect(input).toHaveValue("Draft a release checklist.");
    await input.fill("A revised prompt");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(input).toHaveValue("My unsent follow-up");
    await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`conversation-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    if (page.viewportSize()!.width >= 1024) {
      await revealSidebar(page);
      await page.getByRole("button", { name: "Edit message", exact: true }).click();
      await page.getByRole("button", { name: "Open chat Second review chat", exact: true }).click();
      await expect(input).toHaveValue("Second chat draft");
      await expect(page.getByText("Editing a previous prompt", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toHaveCount(0);
      await page
        .getByRole("button", { name: "Open chat Composer review chat", exact: true })
        .click();
      await expect(input).toHaveValue("My unsent follow-up");
      await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Copy response", exact: true }).first().click();
    const copy = page.getByRole("dialog", { name: "Copy response", exact: true });
    await expect(copy).toBeVisible();
    await expect(copy.getByRole("textbox", { name: "Response text to copy" })).toBeFocused();
    await expect(copy.getByRole("textbox", { name: "Response text to copy" })).toHaveValue(
      /A practical release checklist/,
    );
    await copy.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Copy response", exact: true }).first(),
    ).toBeFocused();
  });
}

test("v11 shared controls preserve chat data and return focus", async ({ page }, info) => {
  await coreFixture(page, "dark");
  const copied: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!functionNames.get(id)?.startsWith("importChatToProject_")) return route.fallback();
    copied.push(route.request().postData() ?? "");
    return route.fulfill({
      json: { result: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, context: {} },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Keep this unsent draft");
  await revealSidebar(page);
  if (await page.getByRole("navigation", { name: "Primary navigation", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Open chat Composer review chat", exact: true }).hover();
  }
  await page.getByRole("button", { name: "Options for Composer review chat", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to project", exact: true }).click();
  const projectChoice = page.getByRole("menuitem", { name: "Review project", exact: true });
  // Touch menus expand inline; short landscape screens scroll their own list.
  await projectChoice.scrollIntoViewIfNeeded();
  await expect(projectChoice).toBeInViewport({ ratio: 1 });
  expect((await projectChoice.boundingBox())!.width).toBeGreaterThanOrEqual(160);
  await expect
    .poll(() =>
      projectChoice.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    )
    .toBe(true);
  await projectChoice.click();
  const projectDialog = page.getByRole("dialog", { name: "Move to project", exact: true });
  await expect(
    projectDialog.getByRole("button", { name: "Move to project", exact: true }),
  ).toBeEnabled();
  await projectDialog.getByRole("button", { name: "Move to project", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chat moved", exact: true })).toBeVisible();
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain("Draft a release checklist.");
  expect(copied[0]).not.toContain("Keep this unsent draft");
  const retained = await page.evaluate(
    async ({ owner, chatA }) => {
      const record = await new Promise<{
        archived: boolean;
        local: { messages: { content: string }[] };
      }>((resolve, reject) => {
        const opening = indexedDB.open("kovagpt-chat-history-v1", 1);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error("The durable history store is missing"));
        };
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction("records", "readonly");
          const request = tx.objectStore("records").get([owner, chatA]);
          request.onsuccess = () => resolve(request.result?.record);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      });
      return { record, draft: localStorage.getItem(`kova-draft-v2:user:${owner}:${chatA}`) };
    },
    { owner, chatA },
  );
  expect(retained.record.archived).toBe(true);
  expect(retained.record.local.messages).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: "Draft a release checklist." })]),
  );
  expect(retained.draft).toBe("Keep this unsent draft");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(input).toHaveValue("Keep this unsent draft");
  await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();

  await page.goto("/");
  await waitForKovaHydration(page);
  // The fixture restores its closed sidebar preference on every navigation.
  // Resolve the visible action if the returning preference closes the sidebar.
  await revealSidebar(page);
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await input.fill("Keep this unsent draft");
  const temporary = page.getByRole("button", { name: "Start temporary chat", exact: true });
  await temporary.click();
  await expect(
    page.getByRole("dialog", { name: "Start a temporary chat", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(temporary).toBeFocused();
  await expect(input).toHaveValue("Keep this unsent draft");

  await page.goto("/projects/33333333-3333-4333-8333-333333333333");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "More project tools", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Timers", exact: true }).click();
  const timer = page.getByRole("button", { name: "Timers", exact: true });
  await timer.click();
  const timerPanel = page.getByRole("region", { name: "Timer controls", exact: true });
  await expect(timerPanel).toBeVisible();
  const panelBox = await timerPanel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(timerPanel).toBeHidden();
  await expect(timer).toBeFocused();
});

test("guest account gate prevents messaging and restores login focus", async ({ page }) => {
  await fixture(page, "light", false);
  let requests = 0;
  await page.route("**/api/chat", (route) => {
    requests++;
    return route.abort("blockedbyclient");
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toHaveCount(0);
  const login = page.getByRole("button", { name: "Log in", exact: true });
  await login.click();
  const dialog = page.getByRole("dialog", { name: "Log in to Kova", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(login).toBeFocused();
  expect(requests).toBe(0);
});

test("authenticated send reaches the actual request path and reports provider failure", async ({
  page,
}) => {
  await fixture(page, "light", true);
  let requests = 0;
  await page.route("**/api/chat", (route) => {
    requests++;
    return route.fulfill({
      status: 503,
      json: {
        error: "Provider unavailable",
        category: "model_provider_failure",
        retryable: false,
        requestId: "composer-local-test",
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(input).toBeEnabled();
  await input.fill("Review this authenticated draft");
  await page.getByTestId("send-button").click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByText(/Provider unavailable|AI provider had a hiccup/).first(),
  ).toBeVisible();
});

test("voice stays disconnected while typing, attachments and Stop retain their contracts", async ({
  page,
}, info) => {
  await fixture(page, "dark");
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        document.documentElement.dataset.unexpectedMicrophoneRequest = "true";
        return Promise.reject(new Error("Microphone access is forbidden in this UI test"));
      },
    });
  });
  let requests = 0;
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    requests++;
    await pendingResponse;
    await route.fulfill({ status: 503, json: { error: "Local fixture stopped" } }).catch(() => {});
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  const voice = page.getByRole("button", { name: "Type with voice", exact: true });
  await expect(input).toBeEnabled();
  await expect(voice).toBeEnabled();
  await expect(page.getByTestId("send-button")).toBeDisabled();
  await geometry(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath("voice-empty-dark.png"), animations: "disabled" });
  await voice.click();
  const dialog = page.getByRole("dialog", { name: "Dictate", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Voice is not available yet");
  await page.screenshot({
    path: info.outputPath("voice-not-connected.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(voice).toBeFocused();
  expect(requests).toBe(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-microphone-request");

  await input.fill(" ");
  await expect(voice).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeDisabled();
  await input.fill("A typed draft");
  await expect(page.getByTestId("send-button")).toBeEnabled();
  await expect(input).toBeFocused();
  await input.dispatchEvent("compositionstart", { data: "あ" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(input).toHaveValue("A typed draft");
  expect(requests).toBe(0);
  await input.dispatchEvent("compositionend", { data: "あ" });
  await page.screenshot({
    path: info.outputPath("voice-switched-to-send.png"),
    animations: "disabled",
  });
  await input.fill("");
  await expect(voice).toBeVisible();
  await expect(input).toBeFocused();

  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "Voice test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic attachment-only message."),
  });
  await expect(page.getByLabel("Remove Voice test.txt", { exact: true })).toBeVisible();
  await expect(voice).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeEnabled();
  await page.getByTestId("send-button").click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await expect(voice).toBeDisabled();
  await expect(page.getByTestId("send-button")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  releaseResponse();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(voice).toBeVisible();
  await geometry(page);

  const thinking = page.getByTestId("thinking-toggle");
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Free composer keeps a quiet writing surface and offers Thinking`, async ({
    page,
  }, info) => {
    await fixture(page, theme);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await input.click();
    await expect(input).toHaveCSS("outline-style", "none");
    await input.fill("Keep this draft while choosing Thinking");
    const thinking = page.getByTestId("thinking-toggle");
    await expect(thinking).toHaveAttribute("aria-pressed", "false");
    await thinking.click();
    await expect(thinking).toHaveAttribute("aria-pressed", "true");
    await expect(thinking).toHaveCSS("color", "rgb(59, 130, 246)");
    await expect(thinking.locator("svg")).toHaveCSS("color", "rgb(59, 130, 246)");
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    await expect(input).toHaveValue("Keep this draft while choosing Thinking");
    await geometry(page);
    await page.screenshot({
      path: info.outputPath(`free-pointer-${theme}.png`),
      animations: "disabled",
    });
  });
}

for (const tier of ["plus", "pro"] as const) {
  test(`${tier}: paid model selection remains available`, async ({ page }, info) => {
    await fixture(page, "dark", true, false, tier);
    await page.goto("/");
    await waitForKovaHydration(page);
    await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
    const picker = page.getByTestId("model-selector-trigger").filter({ visible: true });
    await expect(picker).toBeVisible();
    await picker.click();
    await expect(page.getByTestId("model-option-high")).toHaveText("High");
    await expect(page.getByTestId("model-option-ultra")).toHaveCount(tier === "pro" ? 1 : 0);
    await page.getByTestId("model-option-high").click();
    await expect(picker).toHaveAttribute("aria-label", `Choose model: KovaGPT ${"High"}`);
    await expect(picker).toContainText("High");
    await page.keyboard.press("Escape");
    await geometry(page);
    await page.screenshot({
      path: info.outputPath(`${tier}-selected-model.png`),
      animations: "disabled",
    });
  });
}

test("requested polish: empty composer swaps voice and send and has compact attachment choices", async ({
  page,
}, info) => {
  await fixture(page, "dark", true);
  if (info.project.name === "desktop") {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36",
      }),
    );
  }
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("button", { name: "Start with Write something", exact: true }),
  ).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.clear();
  await expect(page.getByTestId("voice-button")).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeHidden();
  await expect(
    page
      .getByRole("button", { name: "Type with voice", exact: true })
      .locator(".kova-dictation-wave i"),
  ).toHaveCount(3);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await input.fill("A draft stays editable");
  await expect(page.getByTestId("voice-button")).toBeHidden();
  await expect(page.getByTestId("send-button")).toBeVisible();
  const sendTarget = await page.getByTestId("send-button").boundingBox();
  expect(sendTarget!.width).toBe(info.project.name === "phone" ? 44 : 36);
  expect(sendTarget!.height).toBe(info.project.name === "phone" ? 44 : 36);
  await input.clear();
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const menu =
    info.project.name === "phone"
      ? page.getByRole("dialog", { name: "Attach", exact: true })
      : page.getByRole("dialog", { name: "Attach files and tools", exact: true });
  await expect(menu.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await expect(menu.locator("summary").filter({ hasText: /^Plugins$/ })).toBeVisible();
  if (info.project.name === "phone") {
    await expect(menu.getByRole("button", { name: "Photos", exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
  }
  if (info.project.name === "desktop") {
    await expect(menu.getByRole("button", { name: "Photos", exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Camera", exact: true })).toHaveCount(0);
  }
  await menu
    .locator("summary")
    .filter({ hasText: /^Plugins$/ })
    .click();
  const logos = menu.locator("img.kova-composer-plugin-logo");
  expect(await logos.count()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      logos.evaluateAll((images) =>
        images.every(
          (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("polish-attachment-menu.png"),
    animations: "disabled",
  });
});

test("requested polish: Health and Finances own separate connection panels without tab counts", async ({
  page,
}, info) => {
  await coreFixture(page, "dark");
  await page.goto("/apps");
  await waitForKovaHydration(page);
  const tabs = page.getByRole("tablist", { name: "Connections", exact: true });
  for (const name of ["All", "Connected", "Health", "Finances"]) {
    await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await tabs.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bank accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health accounts", exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("polish-finances.png"), animations: "disabled" });
  await tabs.getByRole("tab", { name: "Health", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Health accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bank accounts", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("polish-health.png"), animations: "disabled" });
});

test("requested polish: phone sidebar leaves a chat preview and settings has touch navigation", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Mobile drawer geometry");
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const sidebar = await revealSidebar(page);
  const box = await sidebar.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 64);
  expect(box!.width).toBeGreaterThan(260);
  await page.screenshot({ path: info.outputPath("polish-sidebar.png"), animations: "disabled" });
  const settings = await openCurrentSettings(page);
  await expect(settings).toBeVisible();
  await chooseSettingsSection(page, "General");
  await expect(
    settings.getByRole("switch", { name: "Live web search", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Back to settings", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("polish-settings.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("requested polish: temporary-chat notice remains compact and its privacy details expand", async ({
  page,
}, info) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await page
    .getByRole("button", { name: "Start temporary chat", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Start a temporary chat", exact: true });
  await dialog.getByRole("button", { name: "Start temporary chat", exact: true }).click();
  const banner = page.locator(".kova-temporary-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCSS("border-top-width", "0px");
  await banner.locator("summary").click();
  await expect(banner.getByText(/does not use or update saved memory/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("polish-temporary-chat.png"),
    animations: "disabled",
  });
});
