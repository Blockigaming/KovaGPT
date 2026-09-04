import { expect, test, type Page } from "@playwright/test";

const widths = [320, 375, 390, 768, 1024, 1280, 1440, 1728] as const;
const themes = ["light", "dark"] as const;
const supabaseAuthStorageKeyPattern = /^sb-([a-z0-9]{20})-auth-token$/;
const supabaseRequestPattern = /^https:\/\/[a-z0-9]{20}\.supabase\.co(?:\/|$)/;
const e2eUser = {
  id: "22222222-2222-4222-8222-222222222222",
  aud: "authenticated",
  role: "authenticated",
  email: "shell-parity@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  confirmed_at: "2026-01-01T00:00:00.000Z",
  last_sign_in_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Shell Parity" },
  identities: [],
  factors: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  is_anonymous: false,
};

async function installAuthenticatedFixture(page: Page) {
  await page.addInitScript(
    ({ storageKeyPatternSource, user }) => {
      localStorage.clear();
      const base64Url = (value: unknown) =>
        btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const storageKeyPattern = new RegExp(storageKeyPatternSource);
      const nativeGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        const match = storageKeyPattern.exec(key);
        if (this !== localStorage || !match) return nativeGetItem.call(this, key);

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 60 * 60;
        const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
          iss: `https://${match[1]}.supabase.co/auth/v1`,
          aud: "authenticated",
          role: "authenticated",
          sub: user.id,
          email: user.email,
          aal: "aal1",
          amr: [{ method: "password", timestamp: now }],
          iat: now,
          exp: expiresAt,
        })}.c2ln`;
        return JSON.stringify({
          access_token: accessToken,
          refresh_token: "shell-parity-refresh-token",
          expires_in: 60 * 60,
          expires_at: expiresAt,
          token_type: "bearer",
          user,
        });
      };
    },
    {
      storageKeyPatternSource: supabaseAuthStorageKeyPattern.source,
      user: e2eUser,
    },
  );

  const mockedBackendOrigins = new Set<string>();
  await page.route(supabaseRequestPattern, async (route) => {
    const url = new URL(route.request().url());
    mockedBackendOrigins.add(url.origin);
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(e2eUser),
      });
      return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: url.pathname.includes("/rpc/") ? "null" : "[]",
      });
      return;
    }
    await route.abort("blockedbyclient");
  });
  return mockedBackendOrigins;
}

async function verifyConversationShell(page: Page, width: number, theme: (typeof themes)[number]) {
  await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).not.toContainText(/\b(?:Voice|Dictate)\b/u);
  await expect(page.locator("textarea:visible").first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document, `${width}px ${theme}: document overflow`).toBeLessThanOrEqual(1);
  expect(overflow.body, `${width}px ${theme}: body overflow`).toBeLessThanOrEqual(1);

  const unnamedVisibleButtons = await page.locator("button:visible").evaluateAll(
    (buttons) =>
      buttons.filter((button) => {
        const label =
          button.getAttribute("aria-label") ??
          button.getAttribute("title") ??
          button.textContent ??
          "";
        return !label.trim();
      }).length,
  );
  expect(unnamedVisibleButtons, `${width}px ${theme}: unnamed visible buttons`).toBe(0);
}

test.describe("ChatGPT-like Kova conversation shell", () => {
  test.describe.configure({ timeout: 120_000 });

  test("signed-out shell is responsive, accessible, restrained, and voice-free", async ({
    page,
  }) => {
    for (const theme of themes) {
      for (const width of widths) await verifyConversationShell(page, width, theme);
    }
  });

  test("signed-in shell uses the same required viewport and theme matrix", async ({ page }) => {
    const mockedBackendOrigins = await installAuthenticatedFixture(page);
    for (const theme of themes) {
      for (const width of widths) {
        await verifyConversationShell(page, width, theme);
        await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
      }
    }
    expect(mockedBackendOrigins.size).toBe(1);
  });
});
