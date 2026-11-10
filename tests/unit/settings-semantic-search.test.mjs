import test from "node:test";
import assert from "node:assert/strict";
import { matchesSettingsSearch as matches } from "../../src/lib/settings-search.mjs";

const setting = (id, label, extras = {}) => ({ id, label, ...extras });

test("settings search understands topics instead of requiring the displayed tab name", () => {
  assert.ok(matches(setting("appearance", "Appearance"), "dark colors"));
  assert.ok(matches(setting("security", "Security and login"), "how do I change my password"));
  assert.ok(matches(setting("billing", "Subscriptions"), "where are my receipts"));
  assert.ok(matches(setting("linked", "Connections"), "connect gmail"));
  assert.ok(matches(setting("memory", "Personalization"), "forget something"));
  assert.ok(matches(setting("voice", "Voice"), "microphone sound"));
  assert.ok(matches(setting("usage", "Usage"), "quota remaining"));
});

test("search accepts grouped labels, underlying descriptions, prefixes and a typo", () => {
  assert.ok(
    matches(setting("linked", "Connections", { groups: ["Privacy & workspace"] }), "workspace"),
  );
  assert.ok(matches(setting("appearance", "Appearance"), "apperance"));
  assert.ok(matches(setting("billing", "Subscriptions"), "subscript"));
  assert.ok(
    matches(
      setting("general", "General", {
        description: "Change language and default response options",
      }),
      "language",
    ),
  );
  assert.ok(matches(setting("billing", "Subscriptions"), "upgrade payment"));
});

test("unrelated queries stay unmatched and multiple meaningful words must match", () => {
  assert.equal(matches(setting("billing", "Subscriptions"), "dinosaur"), false);
  assert.equal(matches(setting("security", "Security"), "password horoscope"), false);
  assert.equal(matches(setting("appearance", "Appearance"), "password"), false);
  assert.equal(matches(setting("billing", "Subscriptions"), ""), true);
});
