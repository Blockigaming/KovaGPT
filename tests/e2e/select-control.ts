import { expect, type Locator, type Page } from "@playwright/test";

/** Choose through the visible themed menu; values keep duplicate labels distinct. */
export async function choosePickerValue(page: Page, trigger: Locator, value: string) {
  await trigger.click();
  const option = page.locator(
    `[role="option"][data-select-value=${JSON.stringify(`option:${value}`)}]`,
  );
  await expect(option).toBeVisible();
  await option.click();
}
