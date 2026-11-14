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
  await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
  await expect(page.locator("[data-pricing-plan]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Individual" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("$16", { exact: true })).toBeVisible();
  await expect(page.getByText("$80", { exact: true })).toBeVisible();
  await expect(page.getByText("+ applicable tax", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Start Plus" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  const freePlan = page.locator('[data-pricing-plan="free"]');
  const plusPlan = page.locator('[data-pricing-plan="plus"]');
  const proPlan = page.locator('[data-pricing-plan="pro"]');
  await expect(freePlan.getByText("Very limited chat usage", { exact: true })).toBeVisible();
  await expect(plusPlan.getByText("5× the usage of Free", { exact: true })).toBeVisible();
  await expect(proPlan.getByText("100× the usage of Free", { exact: true })).toBeVisible();
  await expect(proPlan.getByText("20× the usage of Plus", { exact: true })).toBeVisible();
  await expect(
    proPlan.getByText("Unlimited basic chat with Argon Lite", { exact: true }),
  ).toBeVisible();
  await expect(proPlan.getByText("Advanced model usage is limited", { exact: true })).toBeVisible();
  for (const plan of [freePlan, plusPlan])
    await expect(
      plan.getByText("Usage limits apply to all chat models", { exact: true }),
    ).toBeVisible();
  const main = page.locator("main#main-content");
  await expect(main).not.toContainText(
    /50 regular|250 regular|1,750|26,250|5,250|image generations per day|file uploads per day|500 MB|25 GB/,
  );
  await expect(page.getByRole("table")).toContainText("100× Free (20× Plus)");
  await expect(page.getByRole("table")).toContainText("Unlimited with Argon Lite");
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
    const actionBoxes = await actions.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: box.height };
      }),
    );
    for (const coordinate of ["top", "bottom", "height"] as const) {
      const values = actionBoxes.map((box) => box[coordinate]);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
    }
  }

  await page.getByRole("button", { name: "Teams & Enterprise" }).click();
  await expect(page.getByRole("heading", { name: "Plans that grow with you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Enterprise", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard seat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Premium seat" })).toBeVisible();
  await expect(page.locator("[data-pricing-plan]")).toHaveCount(0);
  await page.getByRole("button", { name: "Individual" }).click();
  await expect(
    page.getByRole("table", { name: "KovaGPT Free, Plus, and Pro plan comparison" }),
  ).toBeVisible();
});
