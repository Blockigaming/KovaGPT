import assert from "node:assert/strict";
import test from "node:test";

import {
  composerPreferenceKey,
  legacyComposerSettingsKey,
  readPersistedSendOnEnter,
  unscopedLegacyComposerSettingsKey,
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
    [unscopedLegacyComposerSettingsKey()]: JSON.stringify({ sendOnEnter: true }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), false);
  assert.equal(storage.value(composerPreferenceKey(scope)), "0");
});

test("scoped legacy false migrates without using the unscoped value", () => {
  const scope = "user_456";
  const storage = memoryStorage({
    [legacyComposerSettingsKey(scope)]: JSON.stringify({ sendOnEnter: false }),
    [unscopedLegacyComposerSettingsKey()]: JSON.stringify({ sendOnEnter: true }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), false);
  assert.equal(storage.value(composerPreferenceKey(scope)), "0");
});

test("the old unscoped false value safely migrates when no scoped record exists", () => {
  const scope = "user_from_old_build";
  const storage = memoryStorage({
    [unscopedLegacyComposerSettingsKey()]: JSON.stringify({ sendOnEnter: false }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), false);
  assert.equal(storage.value(composerPreferenceKey(scope)), "0");
});

test("an existing user-scoped value is never replaced by another unscoped value", () => {
  const scope = "user_with_scoped_settings";
  const storage = memoryStorage({
    [legacyComposerSettingsKey(scope)]: JSON.stringify({ sendOnEnter: true }),
    [unscopedLegacyComposerSettingsKey()]: JSON.stringify({ sendOnEnter: false }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), true);
  assert.equal(storage.value(composerPreferenceKey(scope)), "1");
});

test("a scoped record without the preference does not fall through to unscoped data", () => {
  const scope = "user_without_preference";
  const storage = memoryStorage({
    [legacyComposerSettingsKey(scope)]: JSON.stringify({ mode: "dark" }),
    [unscopedLegacyComposerSettingsKey()]: JSON.stringify({ sendOnEnter: false }),
  });

  assert.equal(readPersistedSendOnEnter(storage, scope), true);
  assert.equal(storage.value(composerPreferenceKey(scope)), null);
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
