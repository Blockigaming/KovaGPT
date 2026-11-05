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
  const expected =
    page.viewportSize()!.width < 1024
      ? ["Camera", "Photos", "Files", "Projects", "Create Image", "Drawing"]
      : ["Files", "Library", "Projects", "Create Image", "Drawing"];
  await expect(menu.locator(".kova-composer-quick-menu button")).toHaveText(expected);
  expect(writes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeFocused();
  await expect(input).toHaveValue("Keep this unsent draft.");
});
