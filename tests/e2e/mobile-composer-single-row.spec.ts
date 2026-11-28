import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900", "this spec sets its own viewport");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function controlRows(page: Page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector(".spec400-composer-toolbar");
    if (!toolbar) return null;
    const controls = [
      ...toolbar.querySelectorAll<HTMLElement>(
        ".kova-composer-plus, .kova-thinking-toggle, .kova-consumer-model-trigger, .kova-dictation-button, .spec400-send-button:not([hidden])",
      ),
    ].filter((element) => element.getBoundingClientRect().width > 0);
    const composer = toolbar.closest(".spec400-composer")!.getBoundingClientRect();
    return controls.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.getAttribute("aria-label") ?? element.className,
        centerY: Math.round(rect.top + rect.height / 2),
        left: rect.left,
        right: rect.right,
        inside: rect.left >= composer.left - 0.5 && rect.right <= composer.right + 0.5,
      };
    });
  });
}

for (const tier of ["free", "plus"] as const) {
  for (const width of [320, 360, 375, 390]) {
    test(`${tier} composer keeps one control row at ${width}px`, async ({ page }) => {
      await fixture(page, "dark", true, false, tier);
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.getByRole("button", { name: /^(Thinking|Choose model)/ })).toBeVisible();

      const controls = await controlRows(page);
      expect(controls).not.toBeNull();
      expect(controls!.length).toBeGreaterThanOrEqual(4);
      const rows = new Set(controls!.map((control) => control.centerY));
      expect(
        [...rows].every((y) => Math.abs(y - controls![0].centerY) <= 2),
        JSON.stringify(controls),
      ).toBe(true);
      expect(
        controls!.every((control) => control.inside),
        JSON.stringify(controls),
      ).toBe(true);
      for (let index = 1; index < controls!.length; index++)
        expect(controls![index].left).toBeGreaterThanOrEqual(controls![index - 1].right - 0.5);
    });
  }
}

test("first send from Home shows the message without the transcript placeholder", async ({
  page,
}) => {
  await fixture(page, "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: "Reply." } }] })}\n\ndata: [DONE]\n\n`,
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  // The transcript chunk is fetched while Home is idle.
  await page.waitForLoadState("networkidle");

  const placeholderSeen = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const pane = document.querySelector(".spec400-conversation-pane")!;
        const observer = new MutationObserver(() => {
          if (pane.querySelector(":scope > [data-chat-transcript-loading]")) {
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(pane, { childList: true, subtree: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(false);
        }, 2500);
      }),
  );
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Plan a short trip");
  await page.getByRole("button", { name: /^send/i }).click();
  await expect(page.locator(".kova-conversation-scroll")).toContainText("Plan a short trip", {
    timeout: 1_000,
  });
  expect(await placeholderSeen).toBe(false);
});
