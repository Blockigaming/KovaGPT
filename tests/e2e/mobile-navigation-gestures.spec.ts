import { expect, test, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

async function swipe(page: Page, dx: number, dy = 0) {
  const session = await page.context().newCDPSession(page);
  const x = Math.round(page.viewportSize()!.width * 0.35);
  const y = 140;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 4; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * step) / 4, y: y + (dy * step) / 4 }],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

for (const route of ["/", "/library"]) {
  test(`a deliberate right swipe opens the sidebar across ${route}`, async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 1024, "Mobile drawer gesture");
    await page.goto(route);
    await waitForKovaHydration(page);
    const close = page.getByRole("button", { name: "Close sidebar", exact: true });
    await expect(close).toBeHidden();

    // Browser-generated touches start well away from the left screen edge.
    await swipe(page, 45);
    await expect(close).toBeHidden();
    await swipe(page, -90);
    await expect(close).toBeHidden();
    await swipe(page, 10, 130);
    await expect(close).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).focus();
    await swipe(page, 130, 8);
    await expect(close).toBeVisible();
    await expect(page.getByRole("link", { name: "Plugins", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plans", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(close).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

    // Canceled/multi-touch gestures must not leave a start point that can reopen it.
    for (const interruption of ["touchcancel", "multitouch"] as const) {
      await page
        .locator(route === "/" ? ".kova-empty-chat" : ".kova-app-content")
        .evaluate((target, kind) => {
          const touch = (id: number, x: number) =>
            new Touch({ identifier: id, target, clientX: x, clientY: 140 });
          const dispatch = (type: string, touches: Touch[]) =>
            target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches }));
          dispatch("touchstart", [touch(1, 100)]);
          if (kind === "touchcancel") dispatch("touchcancel", []);
          else dispatch("touchstart", [touch(1, 100), touch(2, 120)]);
          dispatch("touchmove", [touch(1, 250)]);
          dispatch("touchend", []);
        }, interruption);
      await expect(close).toBeHidden();
    }

    if (route === "/") {
      const input = page.getByRole("textbox", { name: "Message KovaGPT" });
      await input.fill("Keep my draft");
      await input.evaluate((target) => {
        for (const [type, x] of [
          ["touchstart", 100],
          ["touchmove", 250],
        ] as const) {
          target.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              touches: [new Touch({ identifier: 1, target, clientX: x, clientY: 400 })],
            }),
          );
        }
        target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
      });
      await expect(close).toBeHidden();
      await expect(input).toHaveValue("Keep my draft");
    }
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await swipe(page, 130);
    await expect(close).toBeHidden();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });
}
