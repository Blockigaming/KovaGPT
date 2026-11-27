import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: developer workspace fits the viewport and navigates its console sections`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await coreFixture(page, theme, "pro");
    await page.route("**/api/developer/console?**", async (route) => {
      await route.fulfill({
        json: {
          enabled: false,
          accounts: [],
          projects: [],
          keys: [],
          limits: [],
          balances: [],
          usage: [],
          limitsPage: 0,
          limitsHasMore: false,
          usagePage: 0,
          usageHasMore: false,
        },
      });
    });
    await page.goto("/developers/console");
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Developer workspace" });
    const mobile = (page.viewportSize()?.width ?? 1440) < 768;
    const destinations = [
      ["Playground", "playground"],
      ["Projects", "projects"],
      ["API keys", "keys"],
      ["Models", "models"],
      ["Files", "files"],
      ["Usage", "usage"],
      ["Costs", "costs"],
      ["Logs", "logs"],
      ["Billing", "billing"],
      ["Limits", "limits"],
      ["Settings", "settings"],
    ] as const;
    for (const [label, section] of destinations) {
      if (mobile) {
        await expect(navigation).toBeHidden();
        await page.getByRole("button", { name: "Open developer navigation" }).click();
      }
      await expect(navigation).toBeVisible();
      await navigation.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`section=${section}(?:&|$)`));
      if (mobile) await expect(navigation).toBeHidden();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        section,
      ).toBe(true);
      const clipped = await page
        .locator(
          "[data-developer-workspace] main input:visible, [data-developer-workspace] main button:visible, [data-developer-workspace] main [role=combobox]:visible",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
            })
            .map((node) => node.textContent || node.getAttribute("aria-label") || node.tagName),
        );
      expect(clipped, section).toEqual([]);
    }
    // Deliberately do not create keys, credits, payments or provider requests.
  });
}

test("320px developer playground quotes before a mocked run and keeps controls inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await coreFixture(page, "dark", "pro");
  let quotedInput: unknown;
  let executions = 0;
  await page.route("**/api/developer/console?**", async (route) => {
    await route.fulfill({
      json: {
        enabled: true,
        accounts: [],
        projects: [],
        keys: [],
        limits: [],
        balances: [],
        usage: [],
        limitsPage: 0,
        limitsHasMore: false,
        usagePage: 0,
        usageHasMore: false,
      },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/models") {
      return route.fulfill({ json: { data: [{ id: "kova-argon-4.6", capability: "chat" }] } });
    }
    if (path === "/api/v1/quotes") {
      quotedInput = request.postDataJSON().input;
      return route.fulfill({
        json: {
          quoteToken: "mock-quote",
          maximumCharge: 3,
          currency: "USD",
          expiresAt: Date.now() + 120_000,
        },
      });
    }
    if (path === "/api/v1/responses") {
      executions++;
      expect(request.postDataJSON()).toEqual(quotedInput);
      expect(request.headers()["x-kova-quote"]).toBe("mock-quote");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      return route.fulfill({ json: { output: [{ text: "Mock response" }] } });
    }
    return route.abort();
  });
  await page.goto("/developers/console?section=playground");
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Playground", exact: true })).toBeVisible();
  await page.getByLabel("API key", { exact: true }).fill("fixture-only-not-a-real-key");
  await page.getByRole("button", { name: "Load available models" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("kova-argon-4.6");
  await page.getByLabel("Input", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Get price quote" }).click();
  await expect(page.getByText("Maximum charge: 3 USD minor units")).toBeVisible();
  expect(executions).toBe(0);
  await page.getByRole("button", { name: "Confirm and run paid request" }).click();
  await expect(page.getByText(/Mock response/)).toBeVisible();
  expect(executions).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  // All provider endpoints above are intercepted; no real paid request is made.
});

test("320px billing renders real wallet projection without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await coreFixture(page, "light", "pro");
  const account = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/developer/console?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has("creditWallet"))
      return route.fulfill({
        json: {
          enabled: true,
          wallet: {
            tracked: true,
            currency: "USD",
            included: 8000,
            purchased: 2500,
            held: 0,
            expired: 0,
            debt: 0,
            suspended: false,
            asOf: "2026-11-26T00:00:00Z",
            renewalAt: "2026-12-26T00:00:00Z",
            lots: [
              {
                id: account,
                kind: "purchased",
                issued_at: "2026-11-26T00:00:00Z",
                expires_at: "2027-11-26T00:00:00Z",
                issued_amount: 2500,
                available_amount: 2500,
                held_amount: 0,
                spent_amount: 0,
                expired_amount: 0,
                reversed_amount: 0,
              },
            ],
            hasMore: false,
          },
        },
      });
    return route.fulfill({
      json: {
        enabled: true,
        accounts: [{ account_id: account, name: "Personal workspace" }],
        projects: [],
        keys: [],
        limits: [],
        usage: [],
        balances: [{ id: account, currency: "USD", available_amount: 10500 }],
        limitsPage: 0,
        limitsHasMore: false,
        usagePage: 0,
        usageHasMore: false,
      },
    });
  });
  await page.route("**/api/developer/funding?**", (route) =>
    route.fulfill({
      json: { enabled: false, offers: [], attempts: [], page: 0, hasMore: false },
    }),
  );
  await page.goto("/developers/console?section=billing");
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "API credit balances" })).toBeVisible();
  await expect(page.getByText("Included Pro", { exact: true })).toBeVisible();
  await expect(page.getByText("Purchased credit", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  // The fixture supplies illustrative balances. No production allowance or payment is triggered.
});

test("playground streaming preserves the quote and renders the terminal response", async ({ page }) => {
  await coreFixture(page, "dark", "pro");
  let quotedInput: unknown;
  let executions = 0;
  await page.route("**/api/developer/console?**", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        accounts: [],
        projects: [],
        keys: [],
        limits: [],
        balances: [],
        usage: [],
        limitsPage: 0,
        limitsHasMore: false,
        usagePage: 0,
        usageHasMore: false,
      },
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/models")
      return route.fulfill({ json: { data: [{ id: "stream-model", capability: "streaming" }] } });
    if (path === "/api/v1/quotes") {
      const body = request.postDataJSON();
      expect(body.operation).toBe("responses");
      expect(body.input.stream).toBe(true);
      quotedInput = body.input;
      return route.fulfill({
        json: {
          quoteToken: "stream-quote",
          maximumCharge: 3,
          currency: "USD",
          expiresAt: Date.now() + 120_000,
        },
      });
    }
    if (path === "/api/v1/responses") {
      executions++;
      expect(request.postDataJSON()).toEqual(quotedInput);
      expect(request.headers()["x-kova-quote"]).toBe("stream-quote");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          { type: "response.output_text.delta", delta: "Streamed " },
          { type: "response.output_text.delta", delta: "response" },
          { type: "response.completed", response: { status: "completed" } },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    }
    return route.abort();
  });
  await page.goto("/developers/console?section=playground");
  await waitForKovaHydration(page);
  await page.getByLabel("API key", { exact: true }).fill("fixture-only-not-a-real-key");
  await page.getByRole("button", { name: "Load available models" }).click();
  await page.getByLabel("Service", { exact: true }).selectOption("streaming");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("stream-model");
  await page.getByLabel("Input", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Get price quote" }).click();
  await expect(page.getByText("Maximum charge: 3 USD minor units")).toBeVisible();
  expect(executions).toBe(0);
  await page.getByRole("button", { name: "Confirm and run paid request" }).click();
  await expect(page.getByText("Streamed response", { exact: true })).toBeVisible();
  expect(executions).toBe(1);
});
