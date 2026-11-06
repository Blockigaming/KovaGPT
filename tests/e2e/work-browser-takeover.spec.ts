import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const signedIn of [true, false]) {
  test(`private-browser bookmark ${signedIn ? "opens Work without starting a browser" : "requires an account"}`, async ({
    page,
  }) => {
    await fixture(page, "dark", signedIn, false, "pro");
    await page.route("**/api/work/sync**", (route) =>
      route.fulfill({
        json: {
          savedRecords: [],
          recentItems: [],
          nextCursor: 0,
          currentVersion: 0,
          hasMore: false,
        },
      }),
    );
    await page.route("**/api/work/execution**", (route) =>
      route.fulfill({
        json: {
          readiness: {
            available: true,
            reason: null,
            modelOptions: [
              {
                mode: "normal",
                label: "Normal",
                model: "kova-argon-4.6",
                available: true,
                reason: null,
                reasoningEfforts: [],
                maxOutputTokens: 4096,
              },
            ],
          },
          runs: [],
          nextCursor: null,
        },
      }),
    );
    const commands: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      // Readiness and owner history may load; bookmarks cannot start or recover a browser.
      const historyRead =
        request.method() === "GET" && ["/api/work/sync", "/api/work/execution"].includes(path);
      if (path.startsWith("/api/work/") && !historyRead) commands.push(request.url());
    });
    await page.goto("/work#browser");
    await waitForKovaHydration(page);
    await expect(page).toHaveURL((url) => url.pathname === "/work" && url.hash === "#browser");
    await expect(
      page.getByRole("region", { name: "Private Work browser", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open browser controls", exact: true }),
    ).toHaveCount(0);
    if (signedIn) {
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Work", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Work execution", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Work execution", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(
        0,
      );
    }
    expect(commands).toEqual([]);
  });
}
