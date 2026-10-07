import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { waitForKovaHydration } from "./hydration";
import { installAuthenticatedFixture } from "./authenticated-fixture";

const origin = "http://127.0.0.1:4189";
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 5000,
}).trim();
let forbiddenHosts: string[];

test.beforeEach(async ({ context, page }) => {
  forbiddenHosts = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (/(?:^|\.)lovable\.(?:app|dev)$/iu.test(host)) forbiddenHosts.push(host);
  });
  // Page-scoped synthetic Auth fixtures take precedence. All other external
  // traffic, including production Supabase, fonts and analytics, is denied.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  await context.routeWebSocket("**/*", (socket) => socket.close());
});

test.afterEach(() => expect(forbiddenHosts).toEqual([]));

test("Node liveness and build identity work; missing backend readiness fails closed", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    ok: true,
    service: "kovagpt-web",
    environment: "ci",
  });
  const version = await request.get("/api/version");
  const identity = await version.json();
  expect(identity.sha).toMatch(/^[a-f0-9]{40}$/u);
  expect(identity.sha).toBe(sourceSha);
  expect(version.headers()["x-kova-build"]).toBe(identity.sha);
  const readiness = await request.get("/api/readyz");
  expect(readiness.status()).toBe(503);
  expect(await readiness.json()).toMatchObject({ status: "unavailable", capabilities: {} });
});

test("home hydrates and serves its scripts and styles from the Node origin", async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.name));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "What can I help with?" }),
  ).toBeVisible();
  const assets = await page
    .locator('script[src], link[rel="stylesheet"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("src") || node.getAttribute("href") || "")
        .filter(Boolean),
    );
  const localAssets = assets
    .map((asset) => new URL(asset, origin))
    .filter((url) => url.origin === origin);
  expect(localAssets.length).toBeGreaterThan(1);
  for (const asset of localAssets)
    expect((await request.get(asset.href)).status(), asset.pathname).toBe(200);
  expect(failures).toEqual([]);
});

test("hosted-auth integration opens and validates the existing password flow without sending credentials", async ({
  page,
}) => {
  await page.goto("/auth?email=azure-test%40example.invalid&mode=sign-in", {
    waitUntil: "domcontentloaded",
  });
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Continue", exact: true });
  await expect(submit).toBeDisabled();
  await password.fill("synthetic-not-submitted");
  await expect(submit).toBeEnabled();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Email address").fill("invalid");
  await page.getByLabel("Email address").blur();
  await expect(submit).toBeDisabled();
});

test("guest Projects and Library routes hydrate without an external service", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: /^projects$/iu }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /sign in to use projects/iu })).toBeVisible();
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("heading", { name: "Saved in this browser", exact: true }),
  ).toBeVisible();
});

test("authenticated shell streams a synthetic response through the existing chat contract", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Azure local stream verified"}}]}\n\ndata: [DONE]\n\n',
    }),
  );
  await page.route("**/api/title", (route) =>
    route.fulfill({ json: { title: "Azure local test" } }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(
    page.locator("header").getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await composer.fill("Synthetic local transport check");
  await composer.press("Enter");
  await expect(
    page.getByText("Azure local stream verified", { exact: true }).first(),
  ).toBeVisible();
});

test("retired integration routes stay absent and chat rejects malformed ingress", async ({
  request,
}) => {
  for (const route of ["/.lovable/oauth/consent", "/lovable/email/auth/webhook"]) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(404);
  }
  const malformed = await request.post("/api/chat", {
    data: "{",
    headers: { "Content-Type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toMatchObject({ code: "invalid_json", retryable: false });
});
