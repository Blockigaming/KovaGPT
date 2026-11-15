import type { Page } from "@playwright/test";

export function usesCompactSettings(page: Page) {
  return page.evaluate(
    () =>
      matchMedia(
        "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)",
      ).matches,
  );
}
