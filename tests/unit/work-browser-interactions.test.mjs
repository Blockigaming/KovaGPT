import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserInteractions } from "../../work-runner/browser-image/interactions.mjs";
test("only owner snapshots expose one-use interaction targets and private responses never enter descriptions", async () => {
  const interactions = createBrowserInteractions(),
    responses = [];
  const id = interactions.add({
    kind: "dialog",
    origin: "https://example.com",
    message: "Enter code",
    prompt: true,
    allow: (value) => responses.push(value),
    deny: () => responses.push("denied"),
  });
  assert.equal(interactions.describe("agent").nodes.length, 0);
  const owner = interactions.describe("owner");
  assert.equal(owner.nodes.length, 2);
  await assert.rejects(interactions.respond(crypto.randomUUID(), "allow", "secret"));
  assert.equal(interactions.size, 1);
  await interactions.respond(id, "allow", "synthetic-secret");
  assert.deepEqual(responses, ["synthetic-secret"]);
  assert.equal(interactions.pending, null);
  assert.equal(JSON.stringify(owner).includes("synthetic-secret"), false);
  await assert.rejects(interactions.respond(id, "allow", "synthetic-secret"));
});
test("interactions interrupt pending page actions and remain bounded without replay on ambiguous continuation", async () => {
  const interactions = createBrowserInteractions();
  let started;
  const active = new Promise((resolve) => {
    started = resolve;
  });
  const waiting = interactions.during(() => {
    started();
    return new Promise(() => {});
  });
  await active;
  const id = interactions.add({
    kind: "popup",
    origin: "https://example.com",
    message: "Open page",
    allow: () => {
      throw Error("unconfirmed");
    },
    deny() {},
  });
  await waiting;
  await assert.rejects(interactions.respond(id, "allow"), /unconfirmed/);
  assert.equal(interactions.size, 0);
  for (let index = 0; index < 3; index++)
    assert.ok(
      interactions.add({
        kind: "popup",
        origin: "https://example.com",
        message: "Open page",
        allow() {},
        deny() {},
      }),
    );
  assert.equal(interactions.add({ kind: "popup" }), null);
  interactions.clear();
  assert.equal(interactions.size, 0);
});
