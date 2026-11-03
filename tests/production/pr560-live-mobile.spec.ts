import { expect, test } from "@playwright/test";
test("inspect actual production mobile navigation", async ({ page }) => {
  test.setTimeout(90000);
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible({
    timeout: 60000,
  });
  const health = await page.request.get("/api/health");
  console.log("LIVE_BUILD", await health.json(), "VIEWPORT", page.viewportSize());
  console.log("LIVE_PUBLIC_UI", await page.locator("body").innerText());
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (x: number, y: number, dx: number, dy: number) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8, id: 1 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const drawer = page.locator("#kova-primary-navigation");
  await expect(drawer).toHaveAttribute("data-state", "closed");
  await swipe(40, 320, 170, 0);
  await expect(drawer).toHaveAttribute("data-state", "open");
  await expect(drawer).toBeVisible();
  const corners = await drawer.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderTopRightRadius, s.borderBottomRightRadius];
  });
  expect(corners.map(parseFloat)).toEqual([24, 24]);
  console.log("LIVE_DRAWER", await drawer.innerText(), "CORNERS", corners);
  await swipe(150, 400, 0, -140);
  await expect(drawer).toHaveAttribute("data-state", "open");
  await swipe(220, 320, -150, 0);
  await expect(drawer).toHaveAttribute("data-state", "closed");
  await page.getByRole("button", { name: "Open menu", exact: true }).tap();
  await expect(drawer).toHaveAttribute("data-state", "open");
  await page.getByRole("button", { name: "Settings", exact: true }).first().tap();
  await expect(page.getByRole("dialog", { name: /Settings/i })).toBeVisible();
  console.log("LIVE_NATIVE_GESTURES_AND_SETTINGS_PASSED");
});
