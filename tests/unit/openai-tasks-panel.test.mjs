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
