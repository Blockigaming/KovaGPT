import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "33333333-3333-4333-8333-333333333333";
const scopes = ["https://www.googleapis.com/auth/gmail.readonly"];
const makeAccount = (id: string, email: string) => ({
  id,
  email,
  connectionRevision: 3,
  connected: true,
  state: "connected",
  scopes,
  has: { gmail: true, gmailWrite: true, calendar: true, calendarWrite: true, drive: true },
});
const first = makeAccount(accountA, "first@example.test"),
  second = makeAccount(accountB, "second@example.test");
const status = (accounts = [first, second], selected: string | null = accountA, revision = 7) => ({
  ...(accounts.find((account) => account.id === selected) ?? {
    connected: false,
    state: "disconnected",
    scopes: [],
    has: {},
  }),
  accounts,
  selectedConnectionId: selected,
  selectionRevision: revision,
});

test("Google account selection, refresh, disconnect and reauthorization retain the displayed account", async ({
  page,
  context,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  let current = status(),
    release: (() => void) | undefined;
  let delaySelect = true,
    delayRefresh = false,
    statusRequested = false;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/google/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().headers().authorization).toMatch(/^Bearer /u);
    if (path.endsWith("/status")) {
      if (delayRefresh) {
        statusRequested = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await route.fulfill({ json: current });
    } else if (path.endsWith("/select")) {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      if (delaySelect)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      current = status([first, second], accountB, 8);
      await route.fulfill({ json: current });
    } else if (path.endsWith("/disconnect")) {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      current = status([first], null, 9);
      await route.fulfill({ json: { ok: true } });
    } else if (path.endsWith("/auth")) {
      expect(new URL(route.request().url()).searchParams.get("connectionId")).toBe(accountA);
      await route.fulfill({
        headers: {
          "set-cookie": "kova_google_oauth_state=browser-fixture; Path=/; HttpOnly; SameSite=Lax",
        },
        json: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture" },
      });
    }
  });
  await page.route("https://accounts.google.com/**", async (route) =>
    route.fulfill({ body: "Mock Google consent" }),
  );
  await page.goto("/apps");
  const appOrigin = new URL(page.url()).origin;
  const panel = page.getByRole("region", { name: "Google accounts" });
  await expect(panel.getByText("first@example.test", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Use second@example.test for new requests" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).toEqual({ connectionId: accountB, expectedRevision: 7 });
  await expect(panel.getByRole("button", { name: "Disconnect first@example.test" })).toBeDisabled();
  await expect(panel.locator("li").filter({ hasText: "first@example.test" })).toContainText(
    "Selected for new requests",
  );
  delaySelect = false;
  release!();
  await expect(panel.locator("li").filter({ hasText: "second@example.test" })).toContainText(
    "Selected for new requests",
  );
  await expect(panel.getByRole("button", { name: "Refresh Google accounts" })).toBeEnabled();
  delayRefresh = true;
  await panel.getByRole("button", { name: "Refresh Google accounts" }).click();
  await expect.poll(() => statusRequested).toBe(true);
  await expect(
    panel.getByRole("button", { name: "Use first@example.test for new requests" }),
  ).toBeDisabled();
  await expect(panel.locator("li").filter({ hasText: "second@example.test" })).toContainText(
    "Selected for new requests",
  );
  delayRefresh = false;
  release!();
  await expect(panel.getByRole("button", { name: "Disconnect second@example.test" })).toBeEnabled();
  await panel.getByRole("button", { name: "Disconnect second@example.test" }).click();
  await expect(panel.getByText("second@example.test", { exact: true })).toHaveCount(0);
  expect(calls[1].body).toEqual({ connectionId: accountB, expectedRevision: 3 });
  current = status(
    [{ ...first, connected: false, state: "reauthorization_required" }],
    accountA,
    10,
  );
  await panel.getByRole("button", { name: "Refresh Google accounts" }).click();
  await panel.getByRole("button", { name: "Reconnect first@example.test" }).click();
  await expect(page).toHaveURL(/accounts\.google\.com/u);
  const cookies = await context.cookies(appOrigin);
  expect(cookies.some((cookie) => cookie.name === "kova_google_oauth_state")).toBe(true);
});

test("a status response arriving after sign-out cannot restore the prior account list", async ({
  page,
}) => {
  const mockedOrigins = await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  let release: (() => void) | undefined,
    calls = 0;
  await page.route("**/api/google/status", async (route) => {
    calls++;
    if (calls > 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: status() });
  });
  await page.goto("/apps");
  await expect(page.getByText("first@example.test", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh Google accounts" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  const origin = [...mockedOrigins][0];
  expect(origin).toBeTruthy();
  await page.evaluate(
    (storageKey) => {
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: "SIGNED_OUT", session: null });
      setTimeout(() => channel.close(), 100);
    },
    `sb-${new URL(origin).hostname.split(".")[0]}-auth-token`,
  );
  await expect(page.getByText("first@example.test", { exact: true })).toHaveCount(0);
  const settled = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/google/status",
  );
  release!();
  await settled;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("button", { name: "Refresh Google accounts" })).toHaveCount(0);
  await expect(page.getByText("first@example.test", { exact: true })).toHaveCount(0);
});
