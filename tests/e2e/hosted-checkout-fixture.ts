import type { Page } from "@playwright/test";
import { functionNames } from "./actual-app-fixture";

/** Synthetic full-page checkout: never reaches Stripe or creates a payment. */
export async function hostedCheckoutFixture(page: Page) {
  const result = { creates: 0, interceptedNavigations: 0 };
  const url = "https://checkout.stripe.com/c/pay/cs_test_ui_review";
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!functionNames.get(id)?.startsWith("createCheckoutSession_")) return route.fallback();
    result.creates++;
    return route.fulfill({ json: { result: { url }, context: {} } });
  });
  await page.context().route("https://checkout.stripe.com/**", (route) => {
    result.interceptedNavigations++;
    return route.fulfill({
      contentType: "text/html",
      body: "<main><h1>Checkout fixture</h1></main>",
    });
  });
  return { result, url };
}
