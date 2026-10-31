import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

for (const [connector, label, permission] of [
  ["gmail", "Gmail", "read email, manage drafts, and send email"],
  ["google-calendar", "Google Calendar", "read and edit calendar events"],
  ["google-drive", "Google Drive", "read Drive files"],
]) {
  test(`${label} Connect sends only its own service selection`, async ({ page }) => {
    await installAuthenticatedFixture(page);
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
    const selections: string[] = [];
    await page.route("**/api/google/auth?**", (route) => {
      const url = new URL(route.request().url());
      selections.push(url.searchParams.get("connector") ?? "missing");
      return route.fulfill({ status: 503, json: { error: "Synthetic consent boundary" } });
    });
    await page.goto("/apps");
    await page.getByRole("button", { name: `Connect ${label}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    await expect(dialog).toContainText(permission);
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect.poll(() => selections).toEqual([connector]);
  });
}
