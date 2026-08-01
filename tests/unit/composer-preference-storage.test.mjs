import assert from "node:assert/strict";
import test from "node:test";

import {
  composerPreferenceKey,
  legacyComposerSettingsKey,
  readPersistedSendOnEnter,
} from "../../src/lib/composer-preference-storage.mjs";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    value(key) {
      return values.get(key) ?? null;
    },
  };
}

test("an existing shared false preference wins over stale default settings", () => {
  const scope = "user_123";
  const storage = memoryStorage({
    [composerPreferenceKey(scope)]: "0",
    [legacyComposerSettingsKey(scope)]: JSON.stringify({ sendOnEnter: true }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), false);
  assert.equal(storage.value(composerPreferenceKey(scope)), "0");
});

test("legacy false migrates after hydration without being overwritten", () => {
  const scope = "user_456";
  const storage = memoryStorage({
    [legacyComposerSettingsKey(scope)]: JSON.stringify({ sendOnEnter: false }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), false);
  assert.equal(storage.value(composerPreferenceKey(scope)), "0");
});

test("missing or malformed preferences use the SSR-safe default", () => {
  assert.equal(readPersistedSendOnEnter(memoryStorage(), "guest"), true);
  assert.equal(
    readPersistedSendOnEnter(
      memoryStorage({ [legacyComposerSettingsKey("guest")]: "{not-json" }),
      "guest",
    ),
    true,
  );
});
