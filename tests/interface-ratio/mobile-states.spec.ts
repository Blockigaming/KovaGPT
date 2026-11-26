import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { coreFixture } from "../e2e/core-app-fixture";
import { usesSidebarDrawer } from "../e2e/current-ui";
import { waitForKovaHydration } from "../e2e/hydration";

async function expectReachable(control: Locator, top: number, bottom: number) {
  await expect(control).toBeVisible();
  await expect(async () => {
    const geometry = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const ancestors = [];
      for (
        let node = element.parentElement;
        node && ancestors.length < 6;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        ancestors.push({
          className: node.className,
          box: node.getBoundingClientRect().toJSON(),
          scrollTop: node.scrollTop,
          maxHeight: style.maxHeight,
          minHeight: style.minHeight,
          flex: style.flex,
          overflow: style.overflow,
          translate: style.translate,
          transform: style.transform,
        });
      }
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: document.documentElement.clientWidth,
        receivesPointer: hit !== null && element.contains(hit),
        hit: hit?.outerHTML.slice(0, 250),
        ancestors,
      };
    });
    expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(top - 1);
    expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(bottom + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.receivesPointer, JSON.stringify(geometry)).toBe(true);
  }).toPass({ timeout: 5_000 });
}

async function simulateKeyboard(page: Page, height: number, top: number) {
  await page.evaluate(
    ({ height, top }) => {
      const visual = window.visualViewport!;
      Object.defineProperties(visual, {
        height: { configurable: true, value: height },
        offsetTop: { configurable: true, value: top },
      });
      visual.dispatchEvent(new Event("resize"));
      visual.dispatchEvent(new Event("scroll"));
    },
    { height, top },
  );
  await expect(page.locator("html")).toHaveAttribute("data-kova-keyboard");
}

test("crossing the phone and tablet boundaries preserves the draft and model menu", async ({
  page,
}, info) => {
  test.skip(
    !["desktop-1440", "phone-390"].includes(info.project.name),
    "one fine and one coarse pointer sweep",
  );
  await coreFixture(page, "dark", "plus");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const draft = "Keep this draft across breakpoints.\nAnd keep the second line.";
  await input.fill(draft);
  for (const width of [767, 768, 1023, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toHaveValue(draft);
    await expect(input).toHaveCSS("font-size", "16px");
    const mobileHeader = page.locator(".kova-chat-main > .kova-topbar:not(.kova-desktop-topbar)");
    if (await usesSidebarDrawer(page)) await expect(mobileHeader).toBeVisible();
    else await expect(mobileHeader).toBeHidden();
    const trigger = page.getByRole("button", { name: /^Choose model and effort/ });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Select model", exact: true });
    await expect(menu).toBeVisible();
    if (width < 768) {
      // Phones anchor the popup directly above the chat bar at the bar's width.
      const bar = (await page.locator(".spec400-composer:visible").first().boundingBox())!;
      await expect.poll(async () => (await menu.boundingBox())?.width).toBeCloseTo(bar.width, 0);
      const above = (await menu.boundingBox())!;
      expect(above.y + above.height).toBeLessThanOrEqual(bar.y);
    } else await expect.poll(async () => (await menu.boundingBox())?.width).toBeCloseTo(282, 0);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue(draft);
    expect(
      await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: saved reading sizes reach the rendered answer after reload`, async ({ page }) => {
    await coreFixture(page, theme, "plus", { preserveStorageOnReload: true });
    for (const [label, size] of [
      ["Large", 18],
      ["Extra large", 20],
    ] as const) {
      await page.goto("/settings/appearance", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await page.getByRole("combobox", { name: "Text size", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      const answer = page.locator(".kova-assistant-message .prose-chat").first();
      await expect(answer).toContainText("A practical release checklist");
      await expect(answer).toHaveCSS("font-size", `${size}px`);
      const paragraph = answer.locator("p").first();
      await expect(paragraph).toHaveCSS("font-size", `${size}px`);
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
  });

  for (const saved of [false, true]) {
    test(`${theme}: ${saved ? "conversation" : "home"} long draft and attachment remain reachable above a panned keyboard`, async ({
      page,
    }, info) => {
      const viewport = page.viewportSize()!;
      test.skip(viewport.width >= 768 && viewport.height > 500, "phone keyboard contract");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await fixture(page, theme, true, saved, "plus");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      await page.evaluate((portrait) => {
        const root = document.documentElement;
        root.style.setProperty("--safe-top", portrait ? "47px" : "0px");
        root.style.setProperty("--safe-left", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-right", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-bottom", portrait ? "34px" : "21px");
      }, viewport.height > viewport.width);
      const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
      const draft = Array.from(
        { length: 24 },
        (_, i) => `Line ${i + 1}: preserve this mobile draft.`,
      ).join("\n");
      await input.fill(draft);
      await page.getByLabel("Choose files", { exact: true }).setInputFiles([
        {
          name: "Mobile draft notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Synthetic mobile attachment, never uploaded to production."),
        },
        {
          name: "Mobile image.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=",
            "base64",
          ),
        },
      ]);
      await expect(page.getByLabel("Remove Mobile draft notes.txt", { exact: true })).toBeVisible();
      await input.focus();
      const height = viewport.height <= 500 ? 220 : 360;
      const top = viewport.height <= 500 ? 12 : 24;
      await simulateKeyboard(page, height, top);
      const shell = page.locator('.kova-assistant[data-ui="modern"]');
      await expect(shell).toHaveAttribute("data-keyboard-open", "true");
      await expect.poll(async () => (await shell.boundingBox())?.height).toBe(height);
      await expect(input).toHaveValue(draft);
      if (!saved) {
        const composer = (await page.locator(".spec400-composer").boundingBox())!;
        const keyboardGap = top + height - composer.y - composer.height;
        expect(keyboardGap).toBeGreaterThanOrEqual(8);
        expect(keyboardGap).toBeLessThanOrEqual(16);
      }
      await info.attach("keyboard-geometry", {
        body: JSON.stringify(
          await page.locator(".spec400-composer").evaluate((element) => ({
            composer: element.getBoundingClientRect().toJSON(),
            input: element.querySelector("textarea")?.getBoundingClientRect().toJSON(),
            toolbar: element
              .querySelector(".spec400-composer-toolbar")
              ?.getBoundingClientRect()
              .toJSON(),
          })),
          null,
          2,
        ),
        contentType: "application/json",
      });
      // The primary action must be immediately tappable while writing, without
      // making the user scroll the composer just to find Send.
      await expectReachable(
        page.getByRole("button", { name: "Send message", exact: true }),
        top,
        top + height,
      );
      await expectReachable(input, top, top + height);
      await expectReachable(
        page.getByRole("button", { name: "Expand input", exact: true }),
        top,
        top + height,
      );
      await expect(input).toHaveCSS("overflow-y", "auto");
      const imageChip = page.locator('.spec400-attachment-chip[data-kind="image"]');
      await expect(imageChip).toHaveCSS("height", "108px");
      await expect(imageChip).toHaveCSS("width", "108px");
      const removeImage = page.getByLabel("Remove Mobile image.png", { exact: true });
      await removeImage.scrollIntoViewIfNeeded();
      await expectReachable(removeImage, top, top + height);
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("keyboard-long-draft.png") });
      expect(errors).toEqual([]);
    });
  }

  test(`${theme}: rotating an expanded draft preserves text, attachments, and dismissal`, async ({
    page,
  }, info) => {
    const viewport = page.viewportSize()!;
    test.skip(viewport.width >= 768 && viewport.height > 500, "phone rotation contract");
    await fixture(page, theme, true, false, "plus");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const draft = "An unsent draft that must survive rotation.\n".repeat(8);
    await input.fill(draft);
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Rotation notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic notes."),
    });
    const trigger = page.getByRole("button", { name: "Expand input", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Expand input", exact: true });
    const editor = dialog.getByRole("textbox", { name: "Message", exact: true });
    await expect(editor).toHaveValue(draft);
    const edited = `${draft}Added in the expanded editor.`;
    await editor.fill(edited);
    for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }, viewport]) {
      await page.setViewportSize(size);
      await page.evaluate((portrait) => {
        const root = document.documentElement;
        root.style.setProperty("--safe-top", portrait ? "47px" : "0px");
        root.style.setProperty("--safe-left", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-right", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-bottom", portrait ? "34px" : "21px");
      }, size.height > size.width);
      await expect(editor).toHaveValue(edited);
      await expectReachable(
        dialog.getByRole("button", { name: "Close", exact: true }),
        0,
        size.height,
      );
      await expectReachable(
        dialog.getByRole("button", { name: "Collapse input", exact: true }),
        0,
        size.height,
      );
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await editor.focus();
    await simulateKeyboard(page, 220, 12);
    await expectReachable(dialog.getByRole("button", { name: "Close", exact: true }), 12, 232);
    await expectReachable(
      dialog.getByRole("button", { name: "Collapse input", exact: true }),
      12,
      232,
    );
    await expectReachable(editor, 12, 232);
    await dialog.getByRole("button", { name: "Collapse input", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(edited);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel("Remove Rotation notes.txt", { exact: true })).toBeVisible();
    await trigger.click();
    await expect(editor).toHaveValue(edited);
    await editor.focus();
    await simulateKeyboard(page, 220, 12);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(edited);
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: info.outputPath("rotated-draft.png") });
  });
}
