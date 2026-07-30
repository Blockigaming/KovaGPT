import { expect, test } from "@playwright/test";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach((_fixtures, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
});

test("connected apps and scheduled tasks expose truthful signed-out states", async ({ page }) => {
  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Your KovaGPT workspace" })).toBeVisible();
  await expect(page.getByText("Sign in to connect apps.")).toBeVisible();
  await expect(page.getByText(/connected/i).first()).toBeVisible();

  await page.goto("/scheduled-tasks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Scheduled Tasks" })).toBeVisible();
  await expect(page.getByText("Sign in to use scheduled tasks")).toBeVisible();
  await expect(page.getByText(/will run once|runner is fully enabled/i)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
