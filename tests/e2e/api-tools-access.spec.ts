import { test, expect } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { openComposerAddMenu } from "./current-ui";

test("attachment menu stays focused on attachments and image creation without invoking services", async ({
  page,
}) => {
  await fixture(page, "dark", true);
  const writes: string[] = [];
  await page.route("**/api/ai/services", (route) => {
    writes.push(route.request().method());
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Keep this unsent draft.");
  const menu = await openComposerAddMenu(page);
  const expected = [
    "Add photos & files",
    "Add from Library",
    "Create an image",
    "Web search",
    "Work in a project",
    "Drawing",
  ];
  if (page.viewportSize()!.width < 1024) expected.push("Camera", "Photos");
  const rows = menu.locator(".kova-composer-quick-menu > button");
  await expect(rows).toHaveCount(expected.length);
  for (const [index, label] of expected.entries())
    await expect(rows.nth(index)).toHaveAccessibleName(label);
  expect(writes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeFocused();
  await expect(input).toHaveValue("Keep this unsent draft.");
});
