import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

async function expectRestingComposer(page: Page) {
  const composer = page.locator(".spec400-composer");
  const compactDesktop = await page.evaluate(
    () => innerWidth >= 1024 && !matchMedia("(any-pointer: coarse)").matches,
  );
  await expect(composer).toHaveCSS("border-radius", "26px");
  await expect(composer).toHaveCSS("display", compactDesktop ? "grid" : "flex");
  if (compactDesktop) {
    await expect.poll(async () => (await composer.boundingBox())?.height).toBe(52);
  } else {
    const input = composer.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await expect.poll(async () => (await input.boundingBox())?.height).toBeGreaterThanOrEqual(26);
    await expect.poll(async () => (await input.boundingBox())?.height).toBeLessThanOrEqual(144);
    // The responsive row has fixed padding, border, gap and 44px actions. Its
    // textarea may wrap at narrow conversation widths, adding real text rows.
    await expect
      .poll(() =>
        composer.evaluate((node) => {
          const input = node.querySelector("textarea")!.getBoundingClientRect();
          return node.getBoundingClientRect().height - input.height;
        }),
      )
      .toBe(74);
  }
  return compactDesktop;
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: empty composer, starter drafts, expand input, Context and Options`, async ({
    page,
  }, info) => {
    await fixture(page, theme, false);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const send = page.getByTestId("send-button");
    const voice = page.getByTestId("voice-button");
    await expect(input).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "What are you working on?", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "Describe what you need…");
    await expectRestingComposer(page);
    await expect(send).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(voice).toBeVisible();
    await expect(voice).toHaveAccessibleName("Voice");
    await expect(voice).toBeDisabled();
    await expect(page.getByText("Continue working", { exact: true })).toHaveCount(0);
    for (const action of ["Write something", "Summarize a file", "Compare options"]) {
      await input.fill("");
      await page.getByRole("button", { name: `Start with ${action}`, exact: true }).click();
      await expect(input).not.toHaveValue("");
      await expect(input).toBeFocused();
      await expect(send).toBeVisible();
      await expect(voice).toBeHidden();
      await expect(page.locator("[data-chat-transcript]")).toHaveCount(0);
    }
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
    await page.getByRole("button", { name: "Context", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "Context", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Options", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Open Context", exact: true })
    .filter({ visible: true })
    .click();
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
