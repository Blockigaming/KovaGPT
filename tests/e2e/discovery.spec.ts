import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const bookmark of [
  "/discovery",
  "/discovery?mode=images",
  "/discovery?mode=shopping",
  "/discovery?mode=local&location=private-place",
]) {
  test(`retired Discover bookmark ${bookmark} opens chat without a search or location request`, async ({
    page,
  }) => {
    await fixture(page, "dark");
    const discoveryRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/discovery")
        discoveryRequests.push(request.url());
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition() {
            document.documentElement.dataset.unexpectedGeolocation = "true";
          },
          watchPosition() {
            document.documentElement.dataset.unexpectedGeolocation = "true";
          },
        },
      });
    });
    await page.goto(bookmark);
    await waitForKovaHydration(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: /discover/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /discover/i })).toHaveCount(0);
    await expect(page.locator('a[href^="/discovery"]')).toHaveCount(0);
    expect(discoveryRequests).toEqual([]);
    await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-geolocation", "true");
  });
}

test("the retired discovery API rejects GET and POST without caching or provider work", async ({
  request,
}) => {
  for (const method of ["GET", "POST"]) {
    const response = await request.fetch("/api/discovery", {
      method,
      ...(method === "POST"
        ? { data: { mode: "local", query: "private-query", location: "private-place" } }
        : {}),
    });
    expect(response.status()).toBe(410);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "This feature has been retired. Use chat search instead.",
    });
  }
});
