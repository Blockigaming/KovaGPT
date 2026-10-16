import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

// Guest local-text fixture only; no sending, provider call or service acceptance.
// Execute only through the existing supported browser harness.
test("390x844 attachment removal target does not overlap preview or filename", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.locator('input[type="file"][accept^="image/*,text/*"]').setInputFiles([
    {
      name: "layout-one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Local layout fixture one."),
    },
    {
      name: "layout-two.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Local layout fixture two."),
    },
  ]);
  const cards = page.locator(".kova-attachment-card");
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card.getByText("Ready", { exact: true })).toBeVisible();
    const geometry = await card.evaluate((root) => {
      const remove = root.querySelector('button[aria-label^="Remove "]')!;
      const hit = remove.getBoundingClientRect();
      const contents = Array.from(root.querySelectorAll(":scope > div, :scope > img"));
      const rect = root.getBoundingClientRect();
      return {
        width: hit.width,
        height: hit.height,
        overlaps: contents.some((node) => {
          const box = node.getBoundingClientRect();
          return (
            Math.min(hit.right, box.right) > Math.max(hit.left, box.left) &&
            Math.min(hit.bottom, box.bottom) > Math.max(hit.top, box.top)
          );
        }),
        insideViewport: rect.left >= 0 && rect.right <= innerWidth,
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.overlaps).toBe(false);
    expect(geometry.insideViewport).toBe(true);
  }
});
