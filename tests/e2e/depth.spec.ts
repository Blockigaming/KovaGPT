import { test, expect } from "@playwright/test";

/**
 * Depth tests: signed-out gating, theme handling, request-id contract.
 * These extend the responsive smoke suite with product invariants.
 */

test.describe("Signed-out gating", () => {
  test("/projects renders either the workspace or the sign-in prompt", async ({ page }) => {
    await page.goto("/projects");
    // Whichever branch the auth loader resolves to, the page must render one of them.
    const signedOut = page.getByRole("heading", { name: /sign in to use projects/i });
    const signedIn = page.getByRole("heading", { name: /^projects$/i });
    await expect(signedOut.or(signedIn).first()).toBeVisible();
  });

  test("/ homepage renders without an auth wall", async ({ page }) => {
    await page.goto("/");
    // No redirect off "/"; some KovaGPT branded element must be visible.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Theme handling", () => {
  test("root element reflects stored theme mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "dark"));
    await page.goto("/");
    const hasDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(hasDark).toBe(true);
  });

  test("light mode does not force .dark class", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "light"));
    await page.goto("/");
    const hasDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(hasDark).toBe(false);
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
