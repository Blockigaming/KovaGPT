import { expect, test, type Page } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
const owner = "22222222-2222-4222-8222-222222222222",
  runId = "33333333-3333-4333-8333-333333333333",
  sessionId = "44444444-4444-4444-8444-444444444444",
  targetId = "55555555-5555-4555-8555-555555555555";
async function fixture(page: Page, { delayFill = false } = {}) {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({ json: { result: [], context: {} } }),
  );
  const now = Date.now(),
    run = {
      id: runId,
      ownerId: owner,
      request: { objective: "Review my signed-in page", source: "work" },
      model: "gpt-5.6-luna",
      status: "paused",
      revision: 3,
      epoch: 0,
      limits: { maxActions: 20, maxTokens: 10000, maxCostMicros: 100000, runtimeMs: 900000 },
      usage: { actions: 0, tokens: 0, costMicros: 0 },
      createdAt: now,
      updatedAt: now,
      deadline: now + 900000,
      approval: null,
      question: null,
      effect: null,
      step: null,
      directions: [],
      outputRefs: [],
      evidence: [],
      event: { kind: "paused", at: now, detail: {} },
    };
  await page.route("**/api/work/execution**", (route) =>
    route.fulfill({
      json: {
        readiness: { available: true, reason: null, modelOptions: [] },
        runs: [run],
        nextCursor: null,
      },
    }),
  );
  let sequence = 1,
    mode = "takeover",
    closed = false,
    releaseFill: () => void = () => {};
  const pendingFill = new Promise<void>((resolve) => (releaseFill = resolve)),
    requests: Record<string, unknown>[] = [];
  await page.route("**/api/work/browser**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toMatch(/^Bearer /);
    if (request.method() === "GET") {
      expect(new URL(request.url()).searchParams.get("expectedUserId")).toBe(owner);
      return route.fulfill({
        json: {
          readiness: { available: true, origins: ["https://browser-fixture.net"] },
          runRevision: 3,
          runStatus: "paused",
          sessions: closed
            ? []
            : [{ id: sessionId, sequence, mode, expires_at: new Date(now + 300000).toISOString() }],
        },
      });
    }
    const body = request.postDataJSON();
    requests.push(body);
    expect(body.expectedUserId).toBe(owner);
    expect(body.runId).toBe(runId);
    expect(body.expectedRevision).toBe(3);
    expect(body.expectedSequence).toBe(sequence);
    sequence++;
    if (body.operation === "fill" && delayFill) await pendingFill;
    if (body.operation === "release") mode = "agent";
    if (body.operation === "takeover") mode = "takeover";
    if (body.operation === "close") closed = true;
    await route
      .fulfill({
        json: {
          expiresAt: now + 300000,
          result: {
            sessionId,
            runId,
            sequence,
            mode,
            ...(closed ? { closed: true } : {}),
            view: crypto.randomUUID(),
            title: "Private fixture",
            url: "https://browser-fixture.net/account",
            text:
              body.operation === "fill"
                ? "LATE PRIVATE RESPONSE"
                : '<img src=x onerror="window.injectedBrowser=true"> Safe account page',
            nodes: [
              {
                id: targetId,
                label: "Password",
                kind: "input",
                inputType: "password",
                editable: true,
                disabled: false,
              },
            ],
          },
        },
      })
      .catch(() => {});
  });
  await page.goto("/work");
  await page.getByLabel("Execution history").selectOption(runId);
  const panel = page.getByRole("region", { name: "Private Work browser", exact: true });
  await expect(panel).toBeVisible();
  return { panel, requests, releaseFill };
}
test("owner takeover sends exact revision and target, keeps credentials transient and renders page text inertly", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.panel.getByRole("button", { name: "Read current page", exact: true }).click();
  await expect(f.panel.getByText("Safe account page", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, "injectedBrowser")),
  ).toBe(false);
  await f.panel.getByRole("combobox", { name: "Page control", exact: true }).selectOption(targetId);
  const field = f.panel.getByLabel("Enter text privately");
  await expect(field).toHaveAttribute("type", "password");
  await field.fill("ephemeral-owner-password");
  await f.panel.getByRole("button", { name: "Fill selected field" }).click();
  await expect.poll(() => f.requests.length).toBe(2);
  expect(f.requests[1]).toMatchObject({
    operation: "fill",
    target: targetId,
    text: "ephemeral-owner-password",
  });
  await expect(field).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain("ephemeral-owner-password");
  await f.panel.getByRole("button", { name: "Give control to Work" }).click();
  await expect(f.panel.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
  await expect(f.panel.getByLabel("Page control")).toHaveCount(0);
  await f.panel.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(f.panel.getByText("You have control.", { exact: false })).toBeVisible();
  await f.panel.getByRole("button", { name: "Close browser", exact: true }).click();
  await expect(f.panel.getByRole("button", { name: "Open and take control" })).toBeVisible();
});
test("principal clear aborts an in-flight private command and rejects its delayed page result", async ({
  page,
}) => {
  const f = await fixture(page, { delayFill: true });
  await f.panel.getByRole("button", { name: "Read current page", exact: true }).click();
  await f.panel.getByRole("combobox", { name: "Page control", exact: true }).selectOption(targetId);
  await f.panel.getByLabel("Enter text privately").fill("pending-private-password");
  await f.panel.getByRole("button", { name: "Fill selected field" }).click();
  await expect.poll(() => f.requests.length).toBe(2);
  await page.evaluate(
    (principal) =>
      window.dispatchEvent(
        new CustomEvent("kova:principal-browser-storage-cleared", { detail: { principal } }),
      ),
    `user:${owner}`,
  );
  f.releaseFill();
  await expect(page.getByText("LATE PRIVATE RESPONSE", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Enter text privately")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Private Work browser", exact: true })).toHaveCount(
    0,
  );
  expect(f.requests.length).toBe(2);
});
