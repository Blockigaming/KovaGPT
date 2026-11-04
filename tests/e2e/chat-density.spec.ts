import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("reply bubbles, adjacent actions, and the compact composer fit the viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    ![
      "phone-320x700",
      "phone-390x844",
      "phone-landscape-844x390",
      "tablet-1024x768",
      "desktop-1440x900",
    ].includes(testInfo.project.name),
  );
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);

  const answer = page.locator("#message-answer-a");
  const bubble = answer.locator(".kova-assistant-message");
  const actions = answer.getByRole("toolbar", { name: "Response actions" });
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  const composer = page.locator('[data-composer-surface="conversation"] .spec400-composer');
  if (!(await bubble.isVisible())) {
    await page
      .getByRole("region", { name: "Continue working" })
      .getByRole("button", { name: /Composer review chat/ })
      .click();
  }
  await expect(bubble).toBeVisible();
  await expect(input).toBeEditable();
  await expect(page.locator("[data-chat-transcript]")).toHaveCSS("scroll-behavior", "auto");
  const [responseBox, actionBox, composerBox] = await Promise.all([
    bubble.boundingBox(),
    actions.boundingBox(),
    composer.boundingBox(),
  ]);
  expect(responseBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  const actionOffset = actionBox!.y - responseBox!.y - responseBox!.height;
  expect(actionOffset).toBeGreaterThanOrEqual(0);
  expect(actionOffset).toBeLessThanOrEqual(3);
  await expect(bubble).toHaveCSS("border-top-left-radius", "26px");
  const copy = actions.getByRole("button", { name: "Copy response", exact: true });
  const good = actions.getByRole("button", { name: "Good response", exact: true });
  const fineDesktop = await page.evaluate(
    () => matchMedia("(min-width: 1024px) and (pointer: fine)").matches,
  );
  const [copyBox, goodBox] = await Promise.all([copy.boundingBox(), good.boundingBox()]);
  expect(copyBox!.width).toBe(fineDesktop ? 32 : 44);
  expect(Math.abs(goodBox!.x - copyBox!.x - copyBox!.width)).toBeLessThanOrEqual(1);
  expect(composerBox!.height).toBeLessThanOrEqual(fineDesktop ? 62 : 92);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );

  await input.fill("First line\nSecond line\nThird line");
  await expect(input).toHaveAttribute("data-multiline", "true");
  await expect
    .poll(async () => (await composer.boundingBox())!.height)
    .toBeGreaterThan(composerBox!.height);
  await input.clear();
  await expect(input).toHaveAttribute("data-multiline", "false");
  await expect
    .poll(async () => (await composer.boundingBox())!.height)
    .toBeLessThanOrEqual(composerBox!.height + 1);
});

test("desktop Settings renders and closes to chat", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  await fixture(page, "dark");
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  const settings = page.locator(".kova-settings-page");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
