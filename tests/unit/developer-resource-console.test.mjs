import assert from "node:assert/strict";
import test from "node:test";
import {
  developerResourceSections,
  resourceConsoleJobDraft,
  resourceConsoleKey,
  resourceConsoleMaySpend,
  resourceConsoleMcpDraft,
  resourceConsolePromptDraft,
  resourceConsoleFollowups,
  resourceConsoleRequest,
  resourceConsoleRequiresConfirmation,
  resourceConsoleTemplate,
} from "../../src/lib/pricing/developer-resource-console.mjs";

const id = "11111111-1111-4111-8111-111111111111";
test("resource console exposes only fixed authenticated resource routes", () => {
  for (const section of Object.keys(developerResourceSections)) {
    assert.deepEqual(resourceConsoleRequest(section, "list", "{}"), {
      method: "GET",
      path: "/api/v1/" + section,
    });
    assert.equal(resourceConsoleRequiresConfirmation(section, "list"), false);
    if (section === "mcp-connections") continue; // Grants are discovered as a bounded list.
    assert.equal(
      resourceConsoleRequest(section, "detail", JSON.stringify({ id })).path,
      "/api/v1/" + section + "?id=" + id,
    );
  }
  for (const section of ["__proto__", "constructor", "../quotes", "responses"])
    assert.throws(() => resourceConsoleRequest(section, "list", "{}"));
  assert.throws(() => resourceConsoleRequest("agents", "constructor", "{}"));
  assert.throws(() => resourceConsoleRequest("agents", "detail", '{"id":"../keys"}'));
  assert.throws(() => resourceConsoleRequest("agents", "list", '{"id":"x"}'));
  assert.throws(() => resourceConsoleRequest("agents", "version", '{"id,version":"unexpected"}'));
});

test("resource credentials must match the selected project's allowed keys", () => {
  const key = "kova_" + id + "_" + "a".repeat(43);
  assert.equal(resourceConsoleKey(key, [id]), key);
  assert.equal(resourceConsoleKey(key, []), null);
  assert.equal(resourceConsoleKey("invalid", [id]), null);
});

test("mutation templates preserve stable IDs and require explicit confirmation", () => {
  const template = resourceConsoleTemplate("agents", "create", () => id);
  const value = JSON.parse(template);
  assert.equal(value.id, id);
  const request = resourceConsoleRequest("agents", "create", template);
  assert.equal(JSON.parse(request.body).operation, "create");
  assert.equal(resourceConsoleRequiresConfirmation("automations", "resume"), true);
  assert.equal(resourceConsoleRequiresConfirmation("webhooks", "rotate"), true);
  assert.equal(resourceConsoleRequiresConfirmation("vector-stores", "search"), false);
  assert.throws(() =>
    resourceConsoleRequest("agents", "create", JSON.stringify({ ...value, operation: "delete" })),
  );
  assert.throws(() =>
    resourceConsoleRequest(
      "vector-stores",
      "entries",
      JSON.stringify({ id, entries: "true", page: 20 }),
    ),
  );
});

test("job screens separate free quotes from explicit paid execution authorization", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const section of ["response-jobs", "batches", "automations"]) {
    const quote = resourceConsoleTemplate(section, "quote", () => id);
    const request = resourceConsoleRequest(section, "quote", quote);
    assert.equal(request.path, "/api/v1/quotes");
    assert.equal(JSON.parse(request.body).operation, "responses");
    assert.equal(resourceConsoleRequiresConfirmation(section, "quote"), false);
    assert.equal(resourceConsoleMaySpend(section, "quote"), false);
    const draft = resourceConsoleTemplate(section, "create", () => id);
    const input = JSON.parse(draft);
    assert.equal(input.id, id);
    assert.equal(input.maximum_charge, 0);
    if (input.items) assert.equal(input.items[0].id, id);
    assert.equal(resourceConsoleRequest(section, "create", draft).path, "/api/v1/" + section);
    assert.equal(resourceConsoleRequiresConfirmation(section, "create"), true);
    assert.equal(resourceConsoleMaySpend(section, "create"), true);
  }
  assert.equal(resourceConsoleMaySpend("automations", "resume"), true);
  assert.equal(resourceConsoleMaySpend("response-jobs", "cancel"), false);
  assert.equal(resourceConsoleMaySpend("agents", "create"), false);
});

test("each supported queue operation can prepare an exact quote-bound draft without spending", () => {
  const now = 1795780800000;
  const result = {
    quoteToken: "payload." + "a".repeat(64),
    currency: "EUR",
    maximumCharge: 1.25,
    expiresAt: now + 60000,
  };
  const operations = {
    quote: "responses",
    quoteStructured: "responses",
    quoteFunction: "responses",
    quoteChat: "chat/completions",
    quoteAgent: "agent-turns",
    quoteAgentSession: "agent-turns",
    quoteModeration: "moderations",
    quoteEmbedding: "embeddings",
    quoteDecision: "decisions",
    quoteSearch: "search",
    quoteAnalysis: "analysis",
  };
  for (const section of ["batches", "automations", "response-jobs"]) {
    for (const [action, operation] of Object.entries(operations)) {
      if (section === "response-jobs" && operation !== "responses") {
        assert.throws(() => resourceConsoleTemplate(section, action, () => id));
        continue;
      }
      const raw = resourceConsoleTemplate(section, action, () => id);
      const quote = resourceConsoleRequest(section, action, raw);
      assert.equal(JSON.parse(quote.body).operation, operation);
      assert.equal(resourceConsoleRequiresConfirmation(section, action), false);
      assert.equal(resourceConsoleMaySpend(section, action), false);
      const draft = JSON.parse(
        resourceConsoleJobDraft(section, action, raw, result, () => id, now),
      );
      assert.equal(draft.maximum_charge, 0);
      assert.equal(draft.currency, "EUR");
      const item = draft.items?.[0] ?? draft;
      assert.deepEqual(item.input, JSON.parse(raw).input);
      assert.equal(item.quote_token, result.quoteToken);
      if (draft.items) assert.equal(item.operation, operation);
      if (section === "automations") assert.equal(item.run_at, "");
      assert.throws(() =>
        resourceConsoleJobDraft(section, action, raw, { ...result, expiresAt: now }, () => id, now),
      );
    }
  }
  assert.throws(() => resourceConsoleJobDraft("batches", "list", "{}", result, () => id, now));
});

test("research console quotes a search and drafts a two-query run without authorizing spending", () => {
  const now = 1795780800000;
  const section = "research-runs";
  const input = resourceConsoleTemplate(section, "quoteSearch", () => id);
  const result = {
    quoteToken: "payload." + "a".repeat(64),
    currency: "USD",
    maximumCharge: 1,
    expiresAt: now + 60000,
  };
  const draft = JSON.parse(
    resourceConsoleJobDraft(section, "quoteSearch", input, result, () => id, now),
  );
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].quote_token, result.quoteToken);
  assert.deepEqual(draft.items[0].input, JSON.parse(input).input);
  assert.equal(draft.items[1].quote_token, "");
  assert.equal(draft.maximum_charge, 0);
  assert.equal(resourceConsoleRequiresConfirmation(section, "create"), true);
  assert.equal(resourceConsoleMaySpend(section, "create"), true);
  assert.equal(resourceConsoleMaySpend(section, "quoteSearch"), false);
});

test("autonomous research console keeps a single exact quoted item and no charge authorization", () => {
  const now = 1795780800000,
    section = "research-runs",
    action = "quoteAutonomous";
  const input = resourceConsoleTemplate(section, action, () => id);
  const result = {
    quoteToken: "payload." + "a".repeat(64),
    currency: "USD",
    maximumCharge: 1,
    expiresAt: now + 60000,
  };
  const draft = JSON.parse(resourceConsoleJobDraft(section, action, input, result, () => id, now));
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].input.research, true);
  assert.deepEqual(draft.items[0].input, JSON.parse(input).input);
  assert.equal(draft.maximum_charge, 0);
  assert.equal(resourceConsoleMaySpend(section, action), false);
});

test("saved prompt controls draft version-bound mutations without executing inference", () => {
  const result = {
    object: "prompt.definition",
    id,
    version: 3,
    definition: { name: "Title", description: "Description", prompt: "Text" },
  };
  const draft = resourceConsolePromptDraft("update", result);
  assert.deepEqual(JSON.parse(resourceConsoleRequest("prompts", "update", draft).body), {
    operation: "update",
    id,
    expected_version: 3,
    definition: result.definition,
  });
  assert.equal(resourceConsoleRequiresConfirmation("prompts", "update"), true);
  assert.equal(resourceConsoleMaySpend("prompts", "update"), false);
  assert.deepEqual(JSON.parse(resourceConsolePromptDraft("version", result)), { id, version: 3 });
  assert.deepEqual(JSON.parse(resourceConsolePromptDraft("delete", result)), { id });
  assert.throws(() => resourceConsolePromptDraft("update", { ...result, version: 20 }));
  assert.throws(() => resourceConsolePromptDraft("update", { ...result, id: "../x" }));
});

test("upload console supports resumable byte parts and non-metered confirmation", () => {
  assert.equal(JSON.parse(resourceConsoleTemplate("uploads", "create", () => id)).id, id);
  assert.deepEqual(JSON.parse(resourceConsoleTemplate("uploads", "append", () => id)), {
    id: "",
    offset: 0,
    data: "",
  });
  const request = resourceConsoleRequest(
    "uploads",
    "append",
    JSON.stringify({ id, offset: 0, data: "YQ==" }),
  );
  assert.equal(request.path, "/api/v1/uploads");
  assert.equal(JSON.parse(request.body).operation, "append");
  for (const action of ["create", "append", "complete", "cancel"]) {
    assert.equal(resourceConsoleRequiresConfirmation("uploads", action), true);
    assert.equal(resourceConsoleMaySpend("uploads", action), false);
  }
});

test("webhook and schedule responses prepare scoped followups without dispatch or bypassing confirmation", () => {
  const event = "22222222-2222-4222-8222-222222222222";
  const endpoint = resourceConsoleFollowups(
    "webhooks",
    "detail",
    "{}",
    { object: "webhook.endpoint", id, generation: 2 },
    () => event,
  );
  assert.deepEqual(
    endpoint.map((x) => x.action),
    ["deliveries", "test", "rotate", "delete"],
  );
  assert.deepEqual(JSON.parse(endpoint[2].draft), { id, expected_generation: 2 });
  const deliveries = resourceConsoleFollowups(
    "webhooks",
    "deliveries",
    JSON.stringify({ id, deliveries: "true" }),
    {
      object: "list",
      data: [
        { id: event, status: "pending", attempts: 2 },
        { id: event, status: "delivered", attempts: 1 },
        { id: event, status: "pending", attempts: 0 },
        { id: event, status: "failed", attempts: 5 },
      ],
    },
    () => event,
  );
  assert.equal(deliveries.length, 1);
  assert.deepEqual(
    JSON.parse(resourceConsoleRequest("webhooks", "retry", deliveries[0].draft).body),
    { operation: "retry", id, event_id: event, expected_attempts: 2 },
  );
  assert.equal(resourceConsoleRequiresConfirmation("webhooks", "retry"), true);
  const batch = {
    object: "batch",
    id,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    items: [{ id: event }],
  };
  assert.deepEqual(
    resourceConsoleFollowups("automations", "detail", "{}", batch, () => event).map(
      (x) => x.action,
    ),
    ["pause", "cancel", "item"],
  );
  assert.deepEqual(
    resourceConsoleFollowups(
      "automations",
      "detail",
      "{}",
      { ...batch, paused_at: "now" },
      () => event,
    ).map((x) => x.action),
    ["resume", "cancel", "item"],
  );
  assert.equal(resourceConsoleMaySpend("automations", "resume"), true);
  assert.deepEqual(
    resourceConsoleFollowups(
      "automations",
      "detail",
      "{}",
      { ...batch, canceled_at: "now" },
      () => event,
    ).map((x) => x.action),
    ["item"],
  );
});

test("MCP discovery drafts only live reviewed read grants and requires a bounded confirmed query", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  const row = {
    id,
    tool_name: "search",
    read_only: true,
    expires_at: new Date(now + 60000).toISOString(),
  };
  const draft = JSON.parse(resourceConsoleMcpDraft(row, now));
  assert.deepEqual(draft, { id, tool: "search", query: "", approved: true });
  for (const invalid of [
    { ...row, read_only: false },
    { ...row, tool_name: "../write" },
    { ...row, expires_at: new Date(now).toISOString() },
    { ...row, id: "bad" },
  ])
    assert.throws(() => resourceConsoleMcpDraft(invalid, now));
  const send = (value) =>
    resourceConsoleRequest("mcp-connections", "invoke", JSON.stringify(value));
  assert.throws(() => send(draft));
  assert.throws(() => send({ ...draft, query: "x".repeat(301) }));
  assert.throws(() => send({ ...draft, query: "read", approved: false }));
  assert.deepEqual(JSON.parse(send({ ...draft, query: "read" }).body), { ...draft, query: "read" });
  assert.equal(resourceConsoleRequiresConfirmation("mcp-connections", "invoke"), true);
});

test("skill lifecycle drafts exact revisions from the retrieved definition", () => {
  const definition = {
    name: "Skill",
    description: "Description",
    instructions: "Use scoped data.",
  };
  const result = { object: "skill.definition", id, version: 3, definition };
  const actions = resourceConsoleFollowups("skills", "detail", "{}", result, () => id);
  assert.deepEqual(
    actions.map((item) => item.action),
    ["version", "update", "delete"],
  );
  assert.deepEqual(JSON.parse(actions[1].draft), { id, definition, expected_version: 3 });
  assert.deepEqual(
    resourceConsoleFollowups("skills", "version", "{}", result, () => id).map(
      (item) => item.action,
    ),
    ["version", "delete"],
  );
  assert.deepEqual(
    resourceConsoleFollowups("skills", "detail", "{}", { ...result, version: 20 }, () => id).map(
      (item) => item.action,
    ),
    ["version", "delete"],
  );
  assert.equal(resourceConsoleRequiresConfirmation("skills", "update"), true);
});
