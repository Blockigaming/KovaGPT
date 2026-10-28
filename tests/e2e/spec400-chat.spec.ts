import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: empty composer, starter drafts, expand input, Context and Options`, async ({
    page,
  }, info) => {
    await fixture(page, theme, false);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const composer = page.locator(".spec400-composer");
    await expect(input).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "What are you working on?", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "Describe what you need…");
    await expect(composer).toHaveCSS("border-radius", "28px");
    const restingHeight = (await composer.boundingBox())!.height;
    expect(restingHeight).toBeGreaterThanOrEqual(128);
    expect(restingHeight).toBeLessThanOrEqual(136);
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Open voice", exact: true })).toHaveCount(0);
    await expect(page.getByText("Continue working", { exact: true })).toHaveCount(0);
    for (const action of ["Write something", "Summarize a file", "Compare options"]) {
      await input.fill("");
      await page.getByRole("button", { name: `Start with ${action}`, exact: true }).click();
      await expect(input).not.toHaveValue("");
      await expect(input).toBeFocused();
      await expect(page.locator("[data-chat-transcript]")).toHaveCount(0);
    }
    await input.fill("Keep the original requirement.");
    const expand = page.getByRole("button", { name: "Expand input", exact: true });
    await expand.click();
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
    await options.getByLabel("Length", { exact: true }).selectOption("long");
    await options.getByLabel("Tone", { exact: true }).selectOption("formal");
    await options.getByLabel("Format", { exact: true }).selectOption("plain");
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
  const composer = page.locator(".spec400-composer");
  await expect(composer).toHaveCSS("border-radius", "28px");
  const width = page.viewportSize()!.width;
  expect((await composer.boundingBox())!.height).toBeGreaterThanOrEqual(width < 1024 ? 120 : 128);
  await input.fill("First line");
  await input.press(width < 1024 ? "Enter" : "Shift+Enter");
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
