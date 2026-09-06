import { expect, test, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

const supabaseAuthStorageKeyPattern = /^sb-([a-z0-9]{20})-auth-token$/;
const supabaseRequestPattern = /^https:\/\/[a-z0-9]{20}\.supabase\.co(?:\/|$)/;
const projects = new Set(["phone-390x844", "desktop-1280x800"]);
const user = {
  id: "22222222-2222-4222-8222-222222222222",
  aud: "authenticated",
  role: "authenticated",
  email: "research-e2e@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  confirmed_at: "2026-01-01T00:00:00.000Z",
  last_sign_in_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Research E2E" },
  identities: [],
  factors: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  is_anonymous: false,
};

async function mockPlusUser(page: Page) {
  await page.addInitScript(
    ({ storageKeyPatternSource, signedInUser }) => {
      localStorage.clear();
      const base64Url = (value: unknown) =>
        btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const storageKeyPattern = new RegExp(storageKeyPatternSource);
      const nativeGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        const match = storageKeyPattern.exec(key);
        if (this !== localStorage || !match) return nativeGetItem.call(this, key);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 3_600;
        const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
          iss: `https://${match[1]}.supabase.co/auth/v1`,
          aud: "authenticated",
          role: "authenticated",
          sub: signedInUser.id,
          email: signedInUser.email,
          iat: now,
          exp: expiresAt,
        })}.c2ln`;
        return JSON.stringify({
          access_token: accessToken,
          refresh_token: "research-e2e-refresh-token",
          expires_in: 3_600,
          expires_at: expiresAt,
          token_type: "bearer",
          user: signedInUser,
        });
      };
    },
    { storageKeyPatternSource: supabaseAuthStorageKeyPattern.source, signedInUser: user },
  );

  await page.route(supabaseRequestPattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(user),
      });
      return;
    }
    if (url.pathname === "/rest/v1/subscriptions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            price_id: "plus_monthly",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.pathname.includes("/rpc/") ? "null" : "[]",
    });
  });
}

const event = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

test("Deep Research renders its completed lifecycle and partial-source warning", async ({
  page,
}, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  await mockPlusUser(page);
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        event({
          kind: "activity",
          tool: "research_plan",
          label: "Creating research plan",
          status: "running",
        }) +
        event({
          kind: "research_progress",
          stage: "planning",
          label: "Create research plan",
          status: "running",
          progress: 0.2,
        }) +
        event({
          kind: "activity",
          tool: "research_plan",
          label: "Research plan ready",
          status: "complete",
        }) +
        event({
          kind: "research_warning",
          label: "Some sources failed",
          detail: "One source could not be reached",
        }) +
        event({
          kind: "research_progress",
          stage: "complete",
          label: "Research complete",
          status: "complete",
          detail: "4 sources used",
          progress: 1,
        }) +
        event({
          content: "## Result\n\nEvidence-backed answer with [Source](https://example.com).",
        }) +
        "data: [DONE]\n\n",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const onboarding = page.getByRole("dialog", { name: "Welcome to KovaGPT" });
  await onboarding.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await onboarding.isVisible().catch(() => false))
    await onboarding.getByRole("button", { name: "Close" }).click();

  await expect(page.locator('button[aria-label="Start temporary chat"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  const deepResearch = page.getByRole("button", { name: "Deep research" });
  await expect(deepResearch).toBeVisible();
  await deepResearch.click();
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Research this topic");
  await page.getByRole("button", { name: "Send message" }).click();

  const progress = page.getByRole("region", { name: "Deep Research progress" });
  await expect(progress).toContainText("Research complete");
  await expect(progress).toContainText("4 sources used");
  await expect(progress).toContainText("One source could not be reached");
  await expect(
    progress.getByRole("progressbar", { name: "Deep Research completion" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("Creating research plan", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Research plan ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
  expect(requestBody).toEqual(
    expect.objectContaining({ clientTool: "deep_research", mode: "thinking" }),
  );
});
