import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
const owner = "22222222-2222-4222-8222-222222222222",
  projectId = "11111111-1111-4111-8111-111111111111";
const choices = [
  {
    mode: "instant",
    label: "Instant",
    model: "gpt-5.6-luna",
    available: true,
    reason: null,
    reasoningEfforts: ["low", "medium"],
    maxOutputTokens: 1200,
    service: "provider_default",
  },
  {
    mode: "normal",
    label: "Normal",
    model: "gpt-5.6-luna",
    available: true,
    reason: null,
    reasoningEfforts: ["low", "medium"],
    maxOutputTokens: 2048,
    service: "provider_default",
  },
  {
    mode: "thinking",
    label: "Thinking",
    model: "gpt-5.6-terra",
    available: true,
    reason: null,
    reasoningEfforts: ["low", "medium", "high"],
    maxOutputTokens: 4096,
    service: "provider_default",
  },
  {
    mode: "deep",
    label: "Deep",
    model: "gpt-5.6-sol",
    available: false,
    reason: "Deep requires Pro.",
    reasoningEfforts: [],
    maxOutputTokens: 8192,
    service: "provider_default",
  },
];
test("Work submits the displayed model mode and effort and shows the saved selection", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", async (route) =>
    route.fulfill({
      json: {
        result: [{ id: projectId, name: "Reports", role: "owner", deletion_requested_at: null }],
        context: {},
      },
    }),
  );
  let runs: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/work/execution**", async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /u);
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          readiness: { available: true, reason: null, modelOptions: choices },
          runs,
          nextCursor: null,
        },
      });
    const body = route.request().postDataJSON();
    requests.push(body);
    const now = Date.now();
    const run = {
      id: crypto.randomUUID(),
      ownerId: owner,
      request: body.input,
      model: "gpt-5.6-terra",
      modelSelection: {
        mode: "thinking",
        reasoningEffort: "high",
        maxOutputTokens: 4096,
        service: "provider_default",
      },
      status: "queued",
      revision: 1,
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
      event: { kind: "admitted", at: now, detail: {} },
    };
    runs = [run];
    return route.fulfill({ json: { state: run } });
  });
  await page.goto("/work");
  const panel = page.getByRole("region", { name: "Work execution", exact: true });
  await expect(panel.getByLabel("Work model mode")).toBeVisible();
  await expect(
    panel.getByLabel("Work model mode").locator('option[value="deep"]'),
  ).toHaveJSProperty("disabled", true);
  await panel.getByLabel("Work model mode").selectOption("thinking");
  await panel.getByLabel("Reasoning effort").selectOption("high");
  await panel.getByLabel("Objective", { exact: true }).fill("Prepare the quarterly report");
  await panel.getByLabel("Save output files in Project").selectOption(projectId);
  await panel.getByRole("button", { name: "Start work", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].input).toMatchObject({ mode: "thinking", reasoningEffort: "high", projectId });
  expect(requests[0].input).not.toHaveProperty("model");
  await expect(panel.getByLabel("Execution model")).toContainText(
    "gpt-5.6-terra · thinking · reasoning: high",
  );
});
test("current option revocation and principal reset clear Work choices without submitting", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/api/**", async (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", async (route) =>
    route.fulfill({ json: { result: [], context: {} } }),
  );
  let modelOptions = choices;
  await page.route("**/api/work/execution**", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      json: {
        readiness: { available: true, reason: null, modelOptions },
        runs: [],
        nextCursor: null,
      },
    });
  });
  await page.goto("/work");
  const panel = page.getByRole("region", { name: "Work execution", exact: true });
  await panel.getByLabel("Work model mode").selectOption("thinking");
  await panel.getByLabel("Reasoning effort").selectOption("high");
  modelOptions = choices.map((item) =>
    item.mode === "thinking" ? { ...item, reasoningEfforts: ["low"] } : item,
  );
  await panel.getByRole("button", { name: "Refresh execution status" }).click();
  await expect(
    panel.getByText("This reasoning choice is no longer available.", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Start work", exact: true })).toBeDisabled();
  await page.evaluate(
    (principal) =>
      window.dispatchEvent(
        new CustomEvent("kova:principal-browser-storage-cleared", { detail: { principal } }),
      ),
    `user:${owner}`,
  );
  await expect(panel.getByLabel("Work model mode")).toHaveValue("normal");
  await expect(panel.getByLabel("Reasoning effort")).toHaveValue("default");
  await expect(panel.getByLabel("Objective", { exact: true })).toHaveValue("");
});
