import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { openResponseOptions } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

async function expectRestingComposer(page: Page) {
  const composer = page.locator(".spec400-composer");
  const compactDesktop = await page.evaluate(
    () => innerWidth >= 1024 && !matchMedia("(any-pointer: coarse)").matches,
  );
  await expect(composer).toHaveCSS("border-radius", "26px");
  await expect(composer).toHaveCSS("display", "flex");
  await expect.poll(async () => (await composer.boundingBox())?.height).toBeGreaterThanOrEqual(128);
  const input = composer.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect.poll(async () => (await input.boundingBox())?.height).toBeGreaterThanOrEqual(26);
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const input = node.querySelector("textarea")!.getBoundingClientRect();
        const toolbar = node.querySelector(".spec400-composer-toolbar")!.getBoundingClientRect();
        return input.bottom <= toolbar.top + 1;
      }),
    )
    .toBe(true);
  return compactDesktop;
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: empty composer, editable drafts, expand input, Context and Options`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const send = page.getByTestId("send-button");
    const voice = page.getByTestId("voice-button");
    await expect(input).toBeEnabled();
    await expect(page.locator("#chat-greeting")).toBeVisible();
    await expect(page.locator("#chat-greeting")).not.toHaveText("");
    await expect(input).toHaveAttribute("placeholder", "Describe what you need…");
    await expectRestingComposer(page);
    await expect(send).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(voice).toBeVisible();
    await expect(voice).toHaveAccessibleName("Voice");
    await expect(voice).toBeEnabled();
    await expect(page.getByText("Continue working", { exact: true })).toHaveCount(0);
    for (const action of ["Write something", "Summarize a file", "Compare options"]) {
      await expect(
        page.getByRole("button", { name: `Start with ${action}`, exact: true }),
      ).toHaveCount(0);
    }
    await input.fill("An editable draft");
    await expect(send).toBeVisible();
    await expect(voice).toBeHidden();
    await expect(page.locator("[data-chat-transcript]")).toHaveCount(0);
    await input.fill("Keep the original requirement.");
    const expand = page.getByRole("button", { name: "Expand input", exact: true });
    await input.press("Tab");
    await expect(expand).toBeFocused();
    await expand.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Expand input", exact: true });
    await expect(dialog).toBeVisible();
    const expandedInput = dialog.getByRole("textbox", { name: "Message", exact: true });
    await expect(expandedInput).toHaveValue("Keep the original requirement.");
    await expandedInput.fill("Keep the original requirement.\nAdd this detail.");
    await dialog.getByRole("button", { name: "Collapse input", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue("Keep the original requirement.\nAdd this detail.");
    await expect(expand).toBeFocused();
    const contextTrigger = page.getByRole("button", { name: "Context", exact: true });
    const contextReturn = (await contextTrigger.isVisible())
      ? contextTrigger
      : page.getByRole("button", { name: "Attach", exact: true });
    if (await contextTrigger.isVisible()) await contextTrigger.click();
    else {
      await contextReturn.click();
      await page
        .getByTestId("mobile-bottom-sheet")
        .locator("summary")
        .filter({ hasText: /^More tools$/ })
        .click();
      await page
        .getByTestId("mobile-bottom-sheet")
        .getByRole("button", { name: "Context", exact: true })
        .click();
    }
    const context = page.getByRole("dialog", { name: "Context", exact: true });
    await expect(context).toBeVisible();
    for (const heading of [
      "Project instructions",
      "Files",
      "Saved results",
      "Conversation context",
    ])
      await expect(context.getByRole("heading", { name: heading })).toBeVisible();
    const viewport = page.viewportSize()!;
    const contextBox = await context.boundingBox();
    expect(contextBox!.width).toBe(viewport.width < 768 ? viewport.width : 300);
    await context.getByRole("button", { name: "Close Context", exact: true }).click();
    await expect(contextReturn).toBeFocused();
    await openResponseOptions(page);
    const options = page.getByRole("dialog", { name: "Response options", exact: true });
    await expect(options).toBeVisible();
    for (const [label, choice] of [
      ["Length", "Detailed"],
      ["Tone", "Formal"],
      ["Format", "Plain text"],
    ]) {
      const trigger = options.getByRole("combobox", { name: label, exact: true });
      await trigger.click();
      await page.getByRole("option", { name: choice, exact: true }).click();
      await expect(trigger).toContainText(choice);
      await expect(trigger).toBeFocused();
    }
    await page.keyboard.press("Escape");
    if (page.viewportSize()!.width < 380)
      await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeFocused();
    await expect(input).toHaveValue("Keep the original requirement.\nAdd this detail.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`empty-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("conversation composer keeps drafts and mobile Enter inserts a newline", async ({
  page,
}, info) => {
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(input).toBeEnabled();
  const compactDesktop = await expectRestingComposer(page);
  await input.fill("First line");
  await input.press(compactDesktop ? "Shift+Enter" : "Enter");
  await expect(input).toHaveValue("First line\n");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  const context = page.getByRole("button", { name: "Context", exact: true });
  if (!(await context.isVisible())) {
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await page
      .getByTestId("mobile-bottom-sheet")
      .locator("summary")
      .filter({ hasText: /^More tools$/ })
      .click();
    await page
      .getByTestId("mobile-bottom-sheet")
      .getByRole("button", { name: "Context", exact: true })
      .click();
  } else {
    await context.click();
  }
  await expect(page.getByRole("dialog", { name: "Context", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("First line\n");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("conversation.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("landscape topbar keeps navigation and actions inside lateral safe areas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const topbar = page.locator('[data-ui-reference="chatgpt-mobile-topbar"]');
  const content = topbar.locator(".kova-topbar-inner");
  const title = topbar.locator("[data-kova-navigation-heading]");
  await expect(topbar).toBeVisible();
  await expect(title).toHaveText("KovaGPT");
  await expect(topbar.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
  await expect(topbar.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
  await expect(
    topbar.getByRole("button", { name: "Start temporary chat", exact: true }),
  ).toBeVisible();
  const original = await page.evaluate(() => {
    const root = document.documentElement;
    const properties = ["--safe-left", "--safe-right", "font-size"].map((name) => ({
      name,
      value: root.style.getPropertyValue(name),
      priority: root.style.getPropertyPriority(name),
    }));
    // Synthetic notch dimensions affect this test context only.
    root.style.setProperty("--safe-left", "31px");
    root.style.setProperty("--safe-right", "47px");
    return properties;
  });
  try {
    await expect(content).toHaveCSS("padding-left", "31px");
    await expect(content).toHaveCSS("padding-right", "47px");
    const headerBox = (await topbar.boundingBox())!;
    expect(headerBox.x).toBe(0);
    expect(headerBox.width).toBe(844);
    const insideSafeArea = (box: { x: number; width: number }) => {
      expect(box.x).toBeGreaterThanOrEqual(31);
      expect(box.x + box.width).toBeLessThanOrEqual(844 - 47);
    };
    for (const child of await content.locator(":scope > *").all()) {
      if (await child.isVisible()) insideSafeArea((await child.boundingBox())!);
    }
    const actions = topbar.getByRole("button").filter({ visible: true });
    expect(await actions.count()).toBeGreaterThanOrEqual(3);
    for (const action of await actions.all()) {
      const box = (await action.boundingBox())!;
      insideSafeArea(box);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(title).toBeVisible();
    insideSafeArea((await title.boundingBox())!);
    expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    // The original px-2 spacing scales with root text when there is no notch.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty("--safe-left", "0px");
      root.style.setProperty("--safe-right", "0px");
      root.style.setProperty("font-size", "32px");
    });
    await expect(content).toHaveCSS("padding-left", "16px");
    await expect(content).toHaveCSS("padding-right", "16px");
  } finally {
    await page.evaluate((properties) => {
      for (const { name, value, priority } of properties) {
        if (value) document.documentElement.style.setProperty(name, value, priority);
        else document.documentElement.style.removeProperty(name);
      }
    }, original);
  }
});
