import { expect, test } from "@playwright/test";
test("inspect actual production mobile navigation", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30000,
  });
  const health = await page.request.get("/api/health");
  console.log("LIVE_BUILD", await health.json(), "VIEWPORT", page.viewportSize());
  console.log("LIVE_PUBLIC_UI", await page.locator("body").innerText());
});
