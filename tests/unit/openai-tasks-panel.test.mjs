import test from "node:test";
import assert from "node:assert/strict";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

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
