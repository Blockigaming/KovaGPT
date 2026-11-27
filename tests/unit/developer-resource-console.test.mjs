import assert from "node:assert/strict";
import test from "node:test";
import {
  developerResourceSections,
  resourceConsoleKey,
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
