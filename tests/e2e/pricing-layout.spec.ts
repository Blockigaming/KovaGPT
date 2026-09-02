import { expect, test } from "@playwright/test";

const pricingProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test("pricing is responsive, truthful, and keeps plan actions aligned", async ({
  page,
}, testInfo) => {
  test.skip(!pricingProjects.has(testInfo.project.name));

  const response = await page.goto("/pricing", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30_000,
  });

  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Upgrade your plan" })).toBeVisible();
  await expect(page.locator("[data-pricing-plan]")).toHaveCount(4);
  await expect(page.getByText("$16", { exact: true })).toBeVisible();
  await expect(page.getByText("$89", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Plus" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  // Deliberately do not activate a paid CTA: this browser check must not create a checkout session.
  await expect(page.getByRole("dialog", { name: "Secure checkout" })).toHaveCount(0);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

  const actions = page.locator("[data-pricing-plan] > button");
  for (let index = 0; index < (await actions.count()); index += 1) {
    const box = await actions.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  if (testInfo.project.name === "desktop-1440x900") {
    const actionBottoms = await actions.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return Math.round(box.bottom);
      }),
    );
    expect(Math.max(...actionBottoms) - Math.min(...actionBottoms)).toBeLessThanOrEqual(2);
  }
});
