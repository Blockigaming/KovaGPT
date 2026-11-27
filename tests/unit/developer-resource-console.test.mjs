import assert from "node:assert/strict";
import test from "node:test";
import {
  developerResourceSections,
  resourceConsoleJobDraft,
  resourceConsoleKey,
  resourceConsoleMaySpend,
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
