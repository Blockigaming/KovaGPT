import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const tier of ["free", "plus"] as const) {
  test(`retired Work bookmark opens ${tier} chat without dispatching execution`, async ({
    page,
  }) => {
    await fixture(page, "dark", true, false, tier);
    const executionRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      // Read-only owner history sync is distinct from any Work command or mutation.
      const historyRead = request.method() === "GET" && path === "/api/work/sync";
      if (path.startsWith("/api/work/") && !historyRead) executionRequests.push(request.url());
    });
    await page.goto("/work?run=retired-bookmark");
    await waitForKovaHydration(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Work execution", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Work", exact: true })).toHaveCount(0);
    if (tier === "free") {
      await expect(page.getByRole("button", { name: "Thinking", exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    } else {
      await page.getByTestId("model-selector-trigger").filter({ visible: true }).click();
      await expect(page.locator('[data-testid^="model-option-"]:visible')).toHaveCount(4);
    }
    expect(executionRequests).toEqual([]);
  });
}
