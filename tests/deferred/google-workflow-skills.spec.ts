// Deferred from launch on 2026-10-07. Preserve these browser regressions for re-enabling the workflow entry.
import { expect, test, type Request } from "@playwright/test";
import { installAuthenticatedFixture } from "../e2e/authenticated-fixture";

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
  configured: true,
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

function isWorkflowSkillDraftMutation(request: Request) {
  const body = request.postData() ?? "";
  return request.method() === "POST" && body.includes('"mutationId"') && body.includes('"draft"');
}

test("workflow skill load failures stay contained and can be retried", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  await page.route("**/api/google/status", async (route) => route.fulfill({ json: status() }));
  await page.route("**/_serverFn/**", async (route) =>
    route.fulfill({ status: 503, json: { error: "Authentication is temporarily unavailable." } }),
  );
  await page.goto("/apps");
  const error = page.getByRole("alert").filter({ hasText: "Workflow skills could not be loaded." });
  await expect(error).toBeVisible();
  await expect(page.getByText("first@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert", { name: "We couldn't load this workspace" })).toHaveCount(0);

  // Restore a valid empty list through the same transport and exercise the real retry UI.
  await page.route("**/_serverFn/**", async (route) =>
    route.fulfill({ json: { result: [], context: {} } }),
  );
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No workflow skills yet.", { exact: false })).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(page.getByText("first@example.test", { exact: true })).toBeVisible();
});

test("workflow skill mutations retain their replay identity until success is confirmed", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  await page.route("**/api/google/status", async (route) => route.fulfill({ json: status() }));
  const mutationBodies: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { result: [], context: {} } });
      return;
    }
    if (!isWorkflowSkillDraftMutation(route.request())) {
      await route.fulfill({ json: { result: { ok: true }, context: {} } });
      return;
    }
    mutationBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      json: {
        result:
          mutationBodies.length === 1
            ? { error: "Authentication is temporarily unavailable." }
            : { ok: true },
        context: {},
      },
    });
  });

  await page.goto("/apps");
  await expect(page.getByText("No workflow skills yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "New skill" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Editorial review");
  await page
    .getByRole("textbox", { name: "Workflow instructions" })
    .fill("Review the draft and check every claim.");

  const createAndInstall = page.getByRole("button", { name: "Create and install" });
  const firstMutationResponse = page.waitForResponse((response) =>
    isWorkflowSkillDraftMutation(response.request()),
  );
  await createAndInstall.click();
  await firstMutationResponse;
  await expect(page.getByText("Workflow skill update could not be confirmed.")).toBeVisible();
  await expect(page.getByText("Workflow skill created and installed")).toHaveCount(0);
  expect(mutationBodies).toHaveLength(1);

  const retryMutationResponse = page.waitForResponse((response) =>
    isWorkflowSkillDraftMutation(response.request()),
  );
  await createAndInstall.click();
  await retryMutationResponse;
  await expect(page.getByText("Workflow skill created and installed")).toBeVisible();
  expect(mutationBodies).toHaveLength(2);
  expect(mutationBodies[1]).toBe(mutationBodies[0]);
});

test("an older workflow skill list response cannot replace mutation-fresh state", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  await page.route("**/api/google/status", async (route) => route.fulfill({ json: status() }));
  const skill = {
    id: "44444444-4444-4444-8444-444444444444",
    revision: 1,
    headVersionId: "55555555-5555-4555-8555-555555555555",
    version: 1,
    name: "Editorial review",
    description: "Review prose",
    instructions: "Review every claim.",
    resources: [],
    digest: "a".repeat(64),
    installationId: "66666666-6666-4666-8666-666666666666",
    installedVersionId: "55555555-5555-4555-8555-555555555555",
    installedVersion: 1,
    installedName: "Editorial review",
    created_at: "2026-09-11T00:00:00.000Z",
    updated_at: "2026-09-11T00:00:00.000Z",
  };
  let captureWorkflowReload = false;
  let workflowListUrl: string | undefined;
  const initialGetUrls = new Set<string>();
  let staleMode = false;
  let staleListCalls = 0;
  let releaseInitial: (() => Promise<void>) | undefined;
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (isWorkflowSkillDraftMutation(request)) {
      if (!workflowListUrl) captureWorkflowReload = true;
      await route.fulfill({ json: { result: { ok: true }, context: {} } });
      return;
    }
    if (request.method() !== "GET") {
      await route.fulfill({ json: { result: { ok: true }, context: {} } });
      return;
    }

    if (captureWorkflowReload && !workflowListUrl && initialGetUrls.has(request.url())) {
      workflowListUrl = request.url();
      captureWorkflowReload = false;
      await route.fulfill({ json: { result: [skill], context: {} } });
      return;
    }

    if (!captureWorkflowReload && !workflowListUrl) initialGetUrls.add(request.url());

    if (staleMode && request.url() === workflowListUrl) {
      staleListCalls += 1;
      if (staleListCalls > 1) {
        await route.fulfill({ json: { result: [skill], context: {} } });
        return;
      }
      await new Promise<void>((resolve) => {
        releaseInitial = async () => {
          await route.fulfill({ json: { result: [], context: {} } });
          resolve();
        };
      });
      return;
    }

    await route.fulfill({ json: { result: [], context: {} } });
  });

  // Discover the generated workflow-list URL from its reload after a known workflow mutation.
  await page.goto("/apps");
  await expect(page.getByText("No workflow skills yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "New skill" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Editorial review");
  await page.getByRole("textbox", { name: "Workflow instructions" }).fill("Review every claim.");
  await page.getByRole("button", { name: "Create and install" }).click();
  await expect.poll(() => workflowListUrl).not.toBeUndefined();
  await expect(page.getByRole("heading", { name: "Editorial review" })).toBeVisible();

  // On a fresh panel instance, keep its initial list request pending past a successful mutation.
  staleMode = true;
  await page.reload();
  await expect.poll(() => staleListCalls).toBe(1);
  await page.getByRole("button", { name: "New skill" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Editorial review");
  await page.getByRole("textbox", { name: "Workflow instructions" }).fill("Review every claim.");
  await page.getByRole("button", { name: "Create and install" }).click();
  await expect.poll(() => staleListCalls).toBe(2);
  await expect(page.getByRole("heading", { name: "Editorial review" })).toBeVisible();

  await releaseInitial!();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("heading", { name: "Editorial review" })).toBeVisible();
  await expect(page.getByText("No workflow skills yet.", { exact: false })).toHaveCount(0);
});
