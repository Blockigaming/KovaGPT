import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(!projects.has(testInfo.project.name));
});

test("connected apps and scheduled tasks expose truthful signed-out states", async ({ page }) => {
  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Apps & plugins", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to connect services" })).toBeVisible();

  await page.goto("/scheduled-tasks", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Scheduled Tasks Status" })).toBeVisible();
  await expect(page.getByText("Sign in to review task history")).toBeVisible();
  await expect(
    page.getByText("Background execution is unavailable in this deployment."),
  ).toBeVisible();
  await expect(page.getByText(/will run once|runner is fully enabled/i)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the built preview serves its safe health endpoint", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["cache-control"]).toBe("no-store");

  const body = await response.json();
  expect(body).toEqual(
    expect.objectContaining({
      ok: true,
      app: "KovaGPT",
      status: "ok",
      service: "kovagpt-web",
      environment: expect.any(String),
      build: expect.any(String),
      timestamp: expect.any(String),
    }),
  );
  expect(JSON.stringify(body)).not.toMatch(
    /secret|token|credential|private|service[_-]?role|api[_-]?key|commit|branch/i,
  );
});
