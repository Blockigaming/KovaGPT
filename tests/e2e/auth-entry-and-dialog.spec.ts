import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

async function expectMinimumTarget(target: Locator, size = 44) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const layoutSize = await target.evaluate((element: HTMLElement) => ({
    width: element.offsetWidth,
    height: element.offsetHeight,
  }));
  expect(layoutSize.width).toBeGreaterThanOrEqual(size);
  expect(layoutSize.height).toBeGreaterThanOrEqual(size);
  return box!;
}

function recordAuthWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/auth\/v1\/(?:token|signup|otp)/u.test(request.url())) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  return writes;
}

test("missing and invalid email deep links return to the canonical auth dialog", async ({
  page,
}) => {
  const authWrites = recordAuthWrites(page);
  const tooLongEmail = `${"a".repeat(321)}@example.com`;
  const cases = [
    { path: "/auth", title: "Log in or sign up" },
    { path: "/auth?email=not-an-email&mode=sign-in", title: "Log in or sign up" },
    {
      path: `/auth?email=${encodeURIComponent(tooLongEmail)}&mode=sign-up`,
      title: "Create your account",
    },
  ];

  for (const entry of cases) {
    await page.goto(entry.path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    const dialog = page.getByRole("dialog", { name: entry.title });
    await expect(dialog, entry.path).toBeVisible();
    await expect(page, entry.path).toHaveURL(/\/$/u);
    await expect(dialog.getByLabel("Email address"), entry.path).toBeFocused();
    await expect(page.getByLabel("Password", { exact: true }), entry.path).toHaveCount(0);
  }

  expect(authWrites).toEqual([]);
});

test("valid email deep links render a named, gated password step", async ({ page }, testInfo) => {
  const authWrites = recordAuthWrites(page);
  await page.goto("/auth?email=Person%2Btest%40Example.com&mode=sign-in", {
    waitUntil: "domcontentloaded",
  });
  await waitForKovaHydration(page);

  await expect(page).toHaveTitle("KovaGPT Account");
  await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveAttribute("tabindex", "-1");
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });

  await expect(email).toHaveValue("Person+test@Example.com");
  expect(await email.evaluate((input: HTMLInputElement) => input.readOnly)).toBe(true);
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("aria-describedby", "kova-auth-page-password-requirement");
  await expect(page.getByText("Use at least 6 characters.", { exact: true })).toBeVisible();
  await expect(continueButton).toBeDisabled();

  await password.fill("12345");
  await password.blur();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(continueButton).toBeDisabled();
  await password.fill("123456");
  await expect(password).toHaveAttribute("aria-invalid", "false");
  await expect(continueButton).toBeEnabled();

  await expectMinimumTarget(page.getByRole("button", { name: "Back", exact: true }));
  await expectMinimumTarget(page.getByRole("button", { name: "Show password" }));

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(email).toBeFocused();
  expect(await email.evaluate((input: HTMLInputElement) => input.readOnly)).toBe(false);
  await email.fill("invalid");
  await email.blur();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
  await expect(continueButton).toBeDisabled();

  await testInfo.attach("valid-password-step", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(authWrites).toEqual([]);
});

test("valid sign-up deep links use account metadata and named fields", async ({ page }) => {
  const authWrites = recordAuthWrites(page);
  await page.goto("/auth?email=new%40example.com&mode=sign-up", {
    waitUntil: "domcontentloaded",
  });
  await waitForKovaHydration(page);

  await expect(page).toHaveTitle("KovaGPT Account");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel(/^Name/u)).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue("new@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  expect(authWrites).toEqual([]);
});

test("auth dialog has one semantic title, one contained close target, and Escape restores focus", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const login = page.getByRole("button", { name: "Log in", exact: true }).first();
  await login.focus();
  await login.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Log in or sign up" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("heading", { name: "Log in or sign up" })).toHaveCount(1);
  const describedBy = await dialog.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText("save your chats");

  const providerFeedback = dialog.getByText(
    /Checking Google availability|Continue with Google|Google sign-in/u,
  );
  await expect(providerFeedback.first()).toBeVisible();

  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toHaveCount(1);
  const closeBox = await expectMinimumTarget(close);
  const viewport = page.viewportSize()!;
  expect(closeBox.x).toBeGreaterThanOrEqual(0);
  expect(closeBox.y).toBeGreaterThanOrEqual(0);
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(viewport.width + 0.01);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(viewport.height + 0.01);

  const dialogEmail = dialog.getByLabel("Email address");
  await expect(dialogEmail).toBeFocused();
  await dialogEmail.blur();
  await expect(dialogEmail).toHaveAttribute("aria-describedby", "kova-auth-email-error");
  await expect(dialog.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
  await dialogEmail.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await testInfo.attach("auth-dialog", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(login).toBeFocused();
});

test("auth dialog close button dismisses the dialog and restores focus", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const login = page.getByRole("button", { name: "Log in", exact: true }).first();
  await login.focus();
  await login.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Log in or sign up" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  // Keep the pointer down long enough for blur validation to render. The close
  // target must not move out from under the pointer before its click fires.
  await close.click({ delay: 100 });
  await expect(dialog).toHaveCount(0);
  await expect(login).toBeFocused();
});
