import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
const observedAt = "2026-09-05T12:00:00.000Z";
async function setup(page: import("@playwright/test").Page) {
  const origins = await installAuthenticatedFixture(page);
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  return origins;
}
test("image discovery contacts no image host until the explicit private-load action", async ({
  page,
}) => {
  await setup(page);
  let images = 0;
  await page.route("https://images.example.com/**", async (route) => {
    images++;
    expect(route.request().headers().referer).toBeUndefined();
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  await page.route("**/api/discovery", async (route) => {
    expect(route.request().headers()["x-kova-expected-user"]).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    expect(route.request().postDataJSON().mode).toBe("images");
    return route.fulfill({
      json: {
        operation: "search",
        mode: "images",
        query: "red coat",
        location: "",
        observedAt,
        results: [
          {
            title: "A red coat",
            url: "https://merchant.example.com/coat",
            source: "merchant.example.com",
            snippet: "",
            observedAt,
            imageUrl: "https://images.example.com/coat.jpg",
          },
        ],
      },
    });
  });
  await page.goto("/discovery");
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await page.getByLabel("Describe the image or product you want to find").fill("red coat");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A red coat" })).toBeVisible();
  expect(images).toBe(0);
  await page.getByRole("button", { name: "Load image from images.example.com" }).click();
  await expect.poll(() => images).toBe(1);
  await expect(
    page.getByText("The host did not allow this image to load privately.", { exact: false }),
  ).toBeVisible();
});
test("shopping compares exact source variants and keeps missing merchant currency unknown", async ({
  page,
}) => {
  await setup(page);
  let checks = 0;
  await page.route("**/api/discovery", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    const body = route.request().postDataJSON();
    if (body.operation === "product") {
      checks++;
      expect(body).toEqual({ operation: "product", sourceToken: "signed-source" });
      return route.fulfill({
        json: {
          operation: "product",
          product: {
            status: "observed",
            title: "Coat",
            url: "https://merchant.example.com/coat",
            sourceUrl: "https://merchant.example.com/coat",
            observedAt,
            variants: [
              {
                ordinal: 0,
                id: "v1",
                sku: "red-s",
                title: "Red / Small",
                values: { color: "red", size: "S" },
                price: { amount: 25, currency: "EUR" },
                inStock: true,
              },
              {
                ordinal: 1,
                id: "v2",
                sku: "blue-l",
                title: "Blue / Large",
                values: { color: "blue", size: "L" },
                price: null,
                inStock: null,
              },
            ],
          },
        },
      });
    }
    return route.fulfill({
      json: {
        operation: "search",
        mode: "shopping",
        query: "coat",
        location: "",
        observedAt,
        results: [
          {
            title: "Coat merchant",
            url: "https://merchant.example.com/coat",
            source: "merchant.example.com",
            snippet: "Some snippet",
            observedAt,
            sourceToken: "signed-source",
          },
        ],
      },
    });
  });
  await page.goto("/discovery");
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page.getByLabel("Describe the image or product you want to find").fill("coat");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coat merchant" })).toBeVisible();
  expect(checks).toBe(0);
  await page.getByRole("button", { name: "Check merchant details" }).click();
  await page.getByRole("button", { name: "Compare this variant" }).first().click();
  await page.getByRole("button", { name: "Compare this variant" }).click();
  const table = page.getByRole("table");
  await expect(table).toContainText("red-s");
  await expect(table).toContainText("blue-l");
  await expect(table).toContainText("25 EUR");
  await expect(table).toContainText("Unknown");
  await expect(table).toContainText("merchant.example.com");
  await page.getByRole("button", { name: "Clear comparison" }).click();
  await expect(table).toHaveCount(0);
});
test("local search shares only manually entered location and a disabled deployment still offers an explicit map handoff", async ({
  page,
}) => {
  await setup(page);
  let locationRequests = 0;
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {
      throw Error("unexpected geolocation");
    };
    navigator.geolocation.watchPosition = () => {
      throw Error("unexpected geolocation");
    };
  });
  await page.route("**/api/discovery", async (route) => {
    if (route.request().method() !== "GET") locationRequests++;
    return route.fulfill({ json: { enabled: false } });
  });
  await page.goto("/maps");
  // Wait for the authenticated availability check before editing this disabled-deployment form.
  await expect(
    page.getByRole("status").filter({ hasText: "Live discovery is not available here yet." }),
  ).toBeVisible();
  await page.getByLabel("What are you looking for?").fill("quiet cafes");
  await page.getByLabel("City, neighborhood, or place (entered manually)").fill("Oslo");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  const handoff = page.getByRole("link", {
    name: "Open this search in Google Maps (shares the entered place)",
  });
  await expect(handoff).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=quiet%20cafes%20Oslo",
  );
  expect(locationRequests).toBe(0);
  await page.getByRole("button", { name: "Remove location" }).click();
  await expect(handoff).toHaveCount(0);
});
test("late discovery response after sign-out cannot restore prior queries or source results", async ({
  page,
}) => {
  const origins = await setup(page);
  let release: (() => void) | undefined;
  await page.route("**/api/discovery", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    await new Promise<void>((resolve) => (release = resolve));
    await route
      .fulfill({
        json: {
          operation: "search",
          mode: "web",
          query: "private search",
          location: "",
          observedAt,
          results: [
            {
              title: "Prior user result",
              url: "https://source.example.com",
              source: "source.example.com",
              snippet: "",
              observedAt,
            },
          ],
        },
      })
      .catch(() => {});
  });
  await page.goto("/discovery");
  await expect(page.getByLabel("What are you looking for?")).toBeVisible();
  await expect(page.getByText("Checking search availability…", { exact: true })).toHaveCount(0);
  await page.getByLabel("What are you looking for?").fill("private search");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  const origin = [...origins][0];
  expect(origin).toBeTruthy();
  await page.evaluate(
    (storageKey) => {
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: "SIGNED_OUT", session: null });
      setTimeout(() => channel.close(), 100);
    },
    `sb-${new URL(origin).hostname.split(".")[0]}-auth-token`,
  );
  await expect(page.getByRole("button", { name: "Sign in to search" })).toBeVisible();
  release!();
  await expect(page.getByText("Prior user result")).toHaveCount(0);
  await expect(page.locator('input[value="private search"]')).toHaveCount(0);
});

test("device privacy reset clears queries and aborts a late request for the captured owner", async ({
  page,
}) => {
  await setup(page);
  let release: (() => void) | undefined;
  await page.route("**/api/discovery", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    await new Promise<void>((resolve) => (release = resolve));
    await route
      .fulfill({
        json: {
          operation: "search",
          mode: "local",
          query: "private cafe",
          location: "Private place",
          observedAt,
          results: [
            {
              title: "Erased source",
              url: "https://source.example.com",
              source: "source.example.com",
              snippet: "",
              observedAt,
            },
          ],
        },
      })
      .catch(() => {});
  });
  await page.goto("/maps");
  await expect(page.getByLabel("What are you looking for?")).toBeVisible();
  await expect(page.getByText("Checking search availability…", { exact: true })).toHaveCount(0);
  await page.getByLabel("What are you looking for?").fill("private cafe");
  await page.getByLabel("City, neighborhood, or place (entered manually)").fill("Private place");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("kova:principal-browser-storage-cleared", {
        detail: { principal: "user:22222222-2222-4222-8222-222222222222" },
      }),
    ),
  );
  await expect(page.getByLabel("What are you looking for?")).toHaveValue("");
  await expect(page.getByLabel("City, neighborhood, or place (entered manually)")).toHaveValue("");
  release!();
  await expect(page.getByText("Erased source")).toHaveCount(0);
});
