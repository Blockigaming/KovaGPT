import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

for (const [connector, label] of [
  ["gmail", "Gmail"],
  ["google-calendar", "Google Calendar"],
  ["google-drive", "Google Drive"],
]) {
  test(`${label} Connect sends only its own service selection`, async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
    await page.route("**/api/google/status", (route) =>
      route.fulfill({
        json: {
          connected: false,
          state: "disconnected",
          scopes: [],
          has: {},
          accounts: [],
          selectedConnectionId: null,
          selectionRevision: 0,
        },
      }),
    );
    await page.route("**/_serverFn/**", (route) =>
      route.fulfill({ json: { result: [], context: {} } }),
    );
    await installAuthenticatedFixture(page, { tier: "plus" });
    const selections: string[] = [];
    await page.route("**/api/google/auth?**", (route) => {
      const url = new URL(route.request().url());
      selections.push(`${url.searchParams.get("connector")}:${url.searchParams.get("access")}`);
      return route.fulfill({ status: 503, json: { error: "Synthetic consent boundary" } });
    });
    await page.goto("/apps");
    await page.getByRole("button", { name: `Connect ${label}`, exact: true }).click();
    await expect.poll(() => selections).toEqual([`${connector}:read`]);
  });
}
