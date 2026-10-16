import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

// Ordinary guest controls only. Run with the existing approved browser harness;
// this regression does not authorize a browser launch or any service mutation.
for (const viewport of [
  { width: 568, height: 320 },
  { width: 844, height: 390 },
  { width: 390, height: 568 },
]) {
  for (const searchOpen of [false, true]) {
    test(`sidebar keyboard reachability ${viewport.width}x${viewport.height}, search=${searchOpen}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/work", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
      const sidebar = page.getByRole("dialog", { name: "Primary navigation" });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.locator("details")).toHaveAttribute("open", "");
      const searchButton = sidebar.getByRole("button", { name: "Search chats", exact: true });
      if (searchOpen) await searchButton.click();
      await searchButton.focus();
      const seen = new Set<string>();
      for (let step = 0; step < 24; step++) {
        await page.keyboard.press("Tab");
        const focused = await sidebar.evaluate((root) => {
          const element = document.activeElement as HTMLElement;
          if (!root.contains(element))
            return { inside: false, label: "", clipped: true, height: 0 };
          const rect = element.getBoundingClientRect();
          let top = 0,
            bottom = innerHeight,
            left = 0,
            right = innerWidth;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent),
              bounds = parent.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
          }
          return {
            inside: true,
            label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
            clipped:
              rect.top < top - 1 ||
              rect.bottom > bottom + 1 ||
              rect.left < left - 1 ||
              rect.right > right + 1,
            height: rect.height,
          };
        });
        expect(focused.inside).toBe(true);
        expect(focused.clipped, focused.label).toBe(false);
        expect(focused.height, focused.label).toBeGreaterThanOrEqual(44);
        seen.add(focused.label);
      }
      for (const label of ["New chat", "Work", "Discover", "Settings", "Log in to KovaGPT"])
        expect(seen.has(label), `keyboard reached ${label}`).toBe(true);
      if (searchOpen)
        await expect(
          sidebar.getByRole("textbox", { name: "Search chats", exact: true }),
        ).toBeVisible();
    });
  }
}
