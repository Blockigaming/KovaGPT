import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

const viewports = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [667, 375],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
] as const;

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900", "this spec sets its own viewport");
  await installAuthenticatedFixture(page);
});

for (const [width, height] of viewports) {
  for (const theme of ["light", "dark"] as const) {
    test(`chat fits ${width}×${height} in ${theme} with enlarged text`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route("**/mobile-spec-image.png", (route) =>
        route.fulfill({
          contentType: "image/png",
          path: "public/kova-logo.png",
        }),
      );
      const imageUrl = new URL("/mobile-spec-image.png", test.info().project.use.baseURL).href;
      const content = [
        "## Responsive report",
        "AnUnbrokenToken".repeat(30),
        "",
        "| Category | Measurement |",
        "| --- | --- |",
        "| One | " + "x".repeat(90) + " |",
        "",
        `![Responsive preview](${imageUrl})`,
        "",
        "```text",
        "long_code_".repeat(40),
        "```",
        "",
        "```kova-chart",
        JSON.stringify({
          title: "Measurements",
          type: "bar",
          data: [{ name: "A very long axis label", value: 4 }],
        }),
        "```",
      ].join("\n");
      await page.route("**/api/chat", (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        }),
      );
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);

      const html = page.locator("html");
      await html.evaluate((element, mode) => {
        element.classList.toggle("dark", mode === "dark");
        element.style.fontSize = "20px";
      }, theme);

      const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
      await expect(composer).toBeVisible();
      await composer.fill("First line\nA second line for this draft.");
      const send = page.getByRole("button", { name: "Send message" });
      await send.scrollIntoViewIfNeeded();
      await expect(send).toBeInViewport({ ratio: 1 });

      if (width < 1024) {
        await page.getByRole("button", { name: "Open menu" }).click();
        const drawer = page.getByRole("dialog", { name: "Primary navigation" });
        await expect(drawer).toBeVisible();
        await drawer.getByRole("button", { name: "Close sidebar", exact: true }).click();
        await expect(drawer).toBeHidden();
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
      }

      await page.getByRole("button", { name: "Attach", exact: true }).click();
      const attachmentOptions = page.getByRole("dialog", { name: "Attach files and tools" });
      if (width < 1024) await expect(attachmentOptions).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(attachmentOptions).toBeHidden();

      if (width < 768 && height > width) {
        await page.setViewportSize({ width: height, height: width });
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
        await page.setViewportSize({ width, height });
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
      }

      await send.click();
      await expect(page.getByRole("heading", { name: "Responsive report" })).toBeAttached();
      const chart = page.getByRole("figure", { name: "Interactive chart: Measurements" });
      await chart.getByRole("button", { name: "Table", exact: true }).click();
      await expect(chart.getByRole("table")).toBeVisible();

      const openImage = page.getByRole("button", { name: "View full size" });
      await openImage.click();
      const imageView = page.getByRole("dialog", { name: "Responsive preview" });
      await expect(imageView.getByRole("img", { name: "Responsive preview" })).toBeVisible();
      if (width < 768) {
        await expect.poll(async () => (await imageView.boundingBox())?.width).toBe(width);
      }
      await imageView.getByRole("button", { name: "Close", exact: true }).click();
      await expect(openImage).toBeFocused();

      expect(await html.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    });
  }
}
