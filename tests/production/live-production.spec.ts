import { expect, test, type Page } from "@playwright/test";

const publicRoutes = ["/", "/pricing", "/help", "/privacy", "/terms"];

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.origin === new URL(page.url() || "https://kovagpt.com").origin &&
      response.status() >= 500
    ) {
      failures.push(`${response.status()} ${url.pathname}`);
    }
  });
  return failures;
}

test("public production routes render without runtime failures or overflow", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  for (const route of publicRoutes) {
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status(), `${route} must load successfully`).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("production headers protect the app without disabling same-origin location", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
});

test("anonymous workspace navigation and focus recovery work in production", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const mobile = page.viewportSize()!.width < 1024;
  const menu = page.getByRole("button", { name: "Open menu" });
  if (mobile) {
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();
  }

  const settings = page.getByRole("button", { name: "Settings" }).first();
  await settings.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Settings/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Settings/i })).toBeHidden();
  await expect(mobile ? menu : settings).toBeFocused();
  expect(failures, failures.join("\n")).toEqual([]);
});
