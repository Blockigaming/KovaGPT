import { expect, test } from "@playwright/test";

for (const width of [320, 1024]) {
  test(`palette ${width}: tabbed buttons activate themselves and the search field stays bounded`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/palette.html");
    await page.getByTestId("trigger").click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    const bounds = await input.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "Close command palette" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("result")).toHaveText("No action taken");
    await expect(page.getByTestId("trigger")).toBeFocused();

    await page.getByTestId("trigger").click();
    await dialog.getByRole("option", { name: "Open settings", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("result")).toHaveText("Settings invoked");

    await page.getByTestId("trigger").click();
    await dialog.getByRole("button", { name: "Retry", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("result")).toHaveText("Retry invoked");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trigger")).toBeFocused();
  });
}

test("IME Enter cannot create a chat, but ordinary combobox Enter still works", async ({
  page,
}) => {
  await page.goto("/palette.html");
  await page.getByTestId("trigger").click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("result")).toHaveText("No action taken");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("result")).toHaveText("New chat invoked");
});

test("pinned and recent actions cannot turn an unmatched query into false results", async ({
  page,
}) => {
  await page.goto("/palette.html");
  await page.evaluate(() => {
    localStorage.setItem("kova-command-pins-v1:v2:guest", JSON.stringify(["/library"]));
    localStorage.setItem("kova-command-history-v1:v2:guest", JSON.stringify(["/images"]));
  });
  await page.getByTestId("trigger").click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("combobox");
  await input.fill("zzzz-unmatched-command");
  await expect(dialog.getByRole("option", { name: /Open Library/ })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: /Generate image/ })).toHaveCount(0);
  await input.fill("library");
  await expect(dialog.getByRole("option", { name: /Open Library/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("result")).toHaveText("No action taken");
});
