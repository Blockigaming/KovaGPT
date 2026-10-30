import test from "node:test";
import assert from "node:assert/strict";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { loadOpenAiTaskAvailability, submitOpenAiTask } from "../../src/lib/openai-task-client.mjs";

test("hosted task availability and execution use the authenticated browser transport", async () => {
  const calls = [];
  const authenticatedFetch = async () => {
    throw Error("The service client should own the route request");
  };
  const ownerId = "owner-one";
  const fixture = reactFixture(
    "src/components/OpenAiTasksPanel.tsx",
    ({ OpenAiTasksPanel }) =>
      () =>
        OpenAiTasksPanel({ ownerId }),
    {
      globals: {
        AbortController,
        crypto: { randomUUID: () => "task_12345678" },
      },
      modules: {
        "@/components/ui/select": {
          Select: "Select",
          SelectContent: "SelectContent",
          SelectItem: "SelectItem",
          SelectTrigger: "SelectTrigger",
          SelectValue: "SelectValue",
        },
        "@/lib/auth-fetch": { authFetch: authenticatedFetch },
        "@/lib/openai-task-client.mjs": {
          loadOpenAiTaskAvailability: async (owner, options) => {
            calls.push({ kind: "availability", owner, fetchImpl: options.fetchImpl });
            return { configured: true, agent: true, browser: true };
          },
          submitOpenAiTask: async (task, options) => {
            calls.push({ kind: "submit", task, fetchImpl: options.fetchImpl });
            return { text: "Task complete" };
          },
        },
      },
    },
  );
  await fixture.flush();
  assert.deepEqual(calls[0], {
    kind: "availability",
    owner: ownerId,
    fetchImpl: authenticatedFetch,
  });
  fixture.find("textarea").props.onChange({ target: { value: "Research a public page" } });
  await fixture.flush();
  fixture.submit();
  await fixture.flush();
  assert.equal(calls[1].kind, "submit");
  assert.equal(calls[1].fetchImpl, authenticatedFetch);
  assert.equal(calls[1].task.ownerId, ownerId);
  assert.equal(calls[1].task.operation, "agent");
  assert.equal(calls[1].task.input, "Research a public page");
  assert.match(fixture.text(), /Task complete/);
  fixture.unmount();
});

test("an issued Browser task completes while the same owner's auth dispatch is fenced for revalidation", async () => {
  let ownerId = "owner-one",
    fenced = false,
    complete;
  const reply = new Promise((resolve) => {
    complete = resolve;
  });
  const calls = [];
  const authenticatedFetch = async (path, options) => {
    assert.equal(fenced, false, "revalidation cannot authorize a new request");
    calls.push({ path, options });
    if (options.method === "GET")
      return Response.json({
        configured: true,
        operations: [
          { operation: "agent", available: true },
          { operation: "browser", available: true },
        ],
      });
    return reply;
  };
  const fixture = reactFixture(
    "src/components/OpenAiTasksPanel.tsx",
    ({ OpenAiTasksPanel }) =>
      () =>
        OpenAiTasksPanel({ ownerId }),
    {
      globals: { AbortController, crypto: { randomUUID: () => "task_12345678" } },
      modules: {
        "@/components/ui/select": {
          Select: "Select",
          SelectContent: "SelectContent",
          SelectItem: "SelectItem",
          SelectTrigger: "SelectTrigger",
          SelectValue: "SelectValue",
        },
        "@/lib/auth-fetch": { authFetch: authenticatedFetch },
        "@/lib/openai-task-client.mjs": { loadOpenAiTaskAvailability, submitOpenAiTask },
      },
    },
  );
  await fixture.flush();
  fixture.find("Select").props.onValueChange("browser");
  fixture.find("textarea").props.onChange({ target: { value: "Read https://example.com/" } });
  await fixture.flush();
  fixture.submit();
  await fixture.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers["x-kova-service-owner"], ownerId);
  const signal = calls[1].options.signal;
  fenced = true;
  // The provider retains its loaded principal/key, so this real component
  // remains mounted with the same owner while the verification gate is shown.
  await fixture.flush();
  assert.equal(signal.aborted, false);
  complete(Response.json({ operation: "browser", text: "Example Domain", toolCalls: 1 }));
  await fixture.flush();
  assert.match(fixture.text(), /Example Domain/);
  assert.match(fixture.text(), /1 browser action/);
  assert.equal(
    calls.length,
    2,
    "completion never re-enters token acquisition or issues another task",
  );
  fenced = false;
  ownerId = "owner-two";
  await fixture.flush();
  assert.doesNotMatch(fixture.text(), /Example Domain/);
  fixture.unmount();
});

function classificationFixture(fetchImpl, owner = { id: "owner-one" }) {
  return reactFixture(
    "src/components/OpenAiTasksPanel.tsx",
    ({ OpenAiTasksPanel }) =>
      () =>
        OpenAiTasksPanel({ ownerId: owner.id }),
    {
      globals: { AbortController, crypto: { randomUUID: () => "task_12345678" } },
      modules: {
        "@/components/ui/select": {
          Select: "Select",
          SelectContent: "SelectContent",
          SelectItem: "SelectItem",
          SelectTrigger: "SelectTrigger",
          SelectValue: "SelectValue",
        },
        "@/lib/auth-fetch": { authFetch: fetchImpl },
        "@/lib/openai-task-client.mjs": { loadOpenAiTaskAvailability, submitOpenAiTask },
      },
    },
  );
}
const classificationAvailability = () =>
  Response.json({
    configured: true,
    operations: [
      { operation: "agent", available: false },
      { operation: "browser", available: false },
      { operation: "decisions", available: true },
      { operation: "moderation", available: true },
    ],
  });

test("a free account can submit a yes/no question through the real Decisions client callback", async () => {
  const calls = [];
  const fixture = classificationFixture(async (path, options) => {
    calls.push({ path, options });
    if (options.method === "GET") return classificationAvailability();
    return Response.json({
      operation: "decisions",
      answers: [{ name: "question", type: "predicate", probability: 0.97 }],
    });
  });
  await fixture.flush();
  assert.equal(
    fixture.find("Select").props.value,
    "decisions",
    "available lightweight tasks stay usable without a paid heavy task",
  );
  fixture.find("textarea").props.onChange({ target: { value: "The screen arrived cracked." } });
  await fixture.flush();
  assert.equal(fixture.find("button", (node) => node.props.type === "submit").props.disabled, true);
  fixture.find("input").props.onChange({ target: { value: "Does the customer report damage?" } });
  await fixture.flush();
  fixture.submit();
  await fixture.flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body).questions, [
    { name: "question", type: "predicate", instructions: "Does the customer report damage?" },
  ]);
  assert.match(fixture.text(), /97\.0%/);
  fixture.unmount();
});

test("moderation displays actual categories and fences stale results after an account change", async () => {
  const owner = { id: "owner-one" };
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const calls = [];
  const fixture = classificationFixture(async (path, options) => {
    calls.push({ path, options });
    if (options.method === "GET") return classificationAvailability();
    return pending;
  }, owner);
  await fixture.flush();
  fixture.find("Select").props.onValueChange("moderation");
  fixture.find("textarea").props.onChange({ target: { value: "Some text for review." } });
  await fixture.flush();
  fixture.submit();
  await fixture.flush();
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    operation: "moderation",
    input: "Some text for review.",
  });
  owner.id = "owner-two";
  await fixture.flush();
  assert.equal(calls[1].options.signal.aborted, true);
  complete(
    Response.json({
      operation: "moderation",
      results: [{ flagged: true, categories: { violence: true } }],
    }),
  );
  await fixture.flush();
  assert.doesNotMatch(fixture.text(), /Flagged categories/);
  assert.equal(fixture.find("textarea").props.value, "");
  assert.equal(fixture.find("button", (node) => node.props.type === "submit").props.disabled, true);
  fixture.find("Select").props.onValueChange("moderation");
  fixture.find("textarea").props.onChange({ target: { value: "A new account draft." } });
  await fixture.flush();
  assert.equal(
    fixture.find("button", (node) => node.props.type === "submit").props.disabled,
    false,
    "old pending request cannot lock the replacement account",
  );
  fixture.unmount();
});

test("the moderation callback renders flagged category results for the current account", async () => {
  const fixture = classificationFixture(async (_path, options) =>
    options.method === "GET"
      ? classificationAvailability()
      : Response.json({
          operation: "moderation",
          results: [{ flagged: true, categories: { violence: true, hate: false } }],
        }),
  );
  await fixture.flush();
  fixture.find("Select").props.onValueChange("moderation");
  fixture.find("textarea").props.onChange({ target: { value: "Review this text." } });
  await fixture.flush();
  fixture.submit();
  await fixture.flush();
  assert.match(fixture.text(), /Flagged categories: violence/);
  fixture.unmount();
});
