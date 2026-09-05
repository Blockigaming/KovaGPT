import type { Page } from "@playwright/test";

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

export async function installAuthenticatedFixture(page: Page) {
  // This fixture exercises the returning-user shell. Server-function onboarding
  // can arrive after hydration; dismiss that separate flow through its real UI
  // without issuing a save/skip request or hiding background accessibility bugs.
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome to KovaGPT" });
  await page.addLocatorHandler(welcomeDialog, async () => {
    await welcomeDialog.getByRole("button", { name: "Close", exact: true }).click();
  });
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
    if (url.pathname === "/rest/v1/user_onboarding") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          primary_use: "work",
          response_style: "balanced",
          completed: true,
          completed_at: "2026-01-01T00:00:00.000Z",
        }),
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
