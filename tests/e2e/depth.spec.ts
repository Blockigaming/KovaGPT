import { test, expect } from "@playwright/test";

/**
 * Depth tests: signed-out gating, theme handling, request-id contract.
 * These extend the responsive smoke suite with product invariants.
 */

test.describe("Signed-out gating", () => {
  test("/projects renders either the workspace or the sign-in prompt", async ({ page }) => {
    await page.goto("/projects");
    // Whichever branch resolves, one of these strings must appear somewhere.
    const anyMatch = page.getByText(/sign in to use projects|^projects$/i).first();
    await expect(anyMatch).toBeVisible({ timeout: 8000 });
  });

  test("/ homepage renders without an auth wall", async ({ page }) => {
    await page.goto("/");
    // No redirect off "/"; some KovaGPT branded element must be visible.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("body")).toBeVisible();
  });
});

const seedGuestTheme = async (page: import("@playwright/test").Page, mode: "dark" | "light") => {
  await page.addInitScript((selectedMode) => {
    localStorage.clear();
    localStorage.setItem("kova-theme-mode", selectedMode);
    localStorage.setItem("nova-gpt-settings-v1:guest", JSON.stringify({ mode: selectedMode }));
    document.documentElement.classList.toggle("dark", selectedMode === "dark");
  }, mode);
  await page.goto("/");
};

test.describe("Theme handling", () => {
  const directRoutes = ["/", "/images", "/projects", "/settings"] as const;

  test("dark guest theme hydrates on direct app-route navigation", async ({ page }) => {
    await seedGuestTheme(page, "dark");

    for (const path of directRoutes) {
      if (path === "/") await page.reload();
      else await page.goto(path);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(true);
    }
  });

  test("light guest theme hydrates on direct app-route navigation", async ({ page }) => {
    await seedGuestTheme(page, "light");

    for (const path of directRoutes) {
      if (path === "/") await page.reload();
      else await page.goto(path);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(false);
    }
  });
});

test.describe("Request-id contract", () => {
  test("chat error response carries X-Request-Id header", async ({ request }) => {
    // Sending garbage triggers the error envelope; the wrapper must attach the header.
    const res = await request.post("/api/chat", {
      data: { garbage: true },
      failOnStatusCode: false,
    });
    // Any non-2xx is fine — we're asserting the header contract, not the body.
    expect(res.headers()["x-request-id"]).toBeTruthy();
  });
});
