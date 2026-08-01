import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  clearPrincipalPreferences,
  clearStoredSettings,
  loadPrincipalStoredRecord,
  loadStoredSettings,
  LOCATION_KEY_BASE,
  principalStorageKey,
  savePrincipalStoredRecord,
  saveStoredSettings,
  settingsKey,
  WORKSPACE_DEFAULTS_KEY_BASE,
} from "../../src/lib/settings-storage.ts";

const LEGACY_SETTINGS_KEY = "nova-gpt-settings-v1";

class MemoryStorage {
  #values = new Map();

  reads = [];
  failNextSet = false;

  getItem(key) {
    this.reads.push(String(key));
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("quota exceeded");
    }
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
    this.reads = [];
    this.failNextSet = false;
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

beforeEach(() => storage.clear());

test("signed-in principals never read or migrate the ownerless legacy settings key", () => {
  const legacy = JSON.stringify({ mode: "dark", responseStyle: "legacy-private" });
  storage.setItem(LEGACY_SETTINGS_KEY, legacy);

  assert.equal(loadStoredSettings("account-a", { migrateLegacyGuest: true }), null);
  assert.deepEqual(storage.reads, [settingsKey("account-a")]);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), legacy);
  assert.equal(storage.getItem(settingsKey("account-a")), null);

  saveStoredSettings("account-a", { mode: "light" });
  storage.reads = [];
  assert.deepEqual(loadStoredSettings("account-a", { migrateLegacyGuest: true }), {
    mode: "light",
  });
  assert.deepEqual(storage.reads, [settingsKey("account-a")]);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), legacy);
});

test("only a confirmed guest can claim valid legacy guest settings", () => {
  const legacy = JSON.stringify({ mode: "dark", responseStyle: "concise" });
  storage.setItem(LEGACY_SETTINGS_KEY, legacy);

  assert.equal(loadStoredSettings(null), null);
  assert.deepEqual(storage.reads, [settingsKey(null)]);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), legacy);

  assert.deepEqual(loadStoredSettings(null, { migrateLegacyGuest: true }), {
    mode: "dark",
    responseStyle: "concise",
  });
  assert.equal(storage.getItem(settingsKey(null)), legacy);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), null);
});

test("invalid or unwritable legacy settings are never destructively migrated", () => {
  storage.setItem(LEGACY_SETTINGS_KEY, "not-json");
  assert.equal(loadStoredSettings(null, { migrateLegacyGuest: true }), null);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), "not-json");
  assert.equal(storage.getItem(settingsKey(null)), null);

  const legacy = JSON.stringify({ mode: "light" });
  storage.setItem(LEGACY_SETTINGS_KEY, legacy);
  storage.failNextSet = true;
  assert.deepEqual(loadStoredSettings(null, { migrateLegacyGuest: true }), { mode: "light" });
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), legacy);
  assert.equal(storage.getItem(settingsKey(null)), null);
});

test("clearing settings is scoped to the current principal", () => {
  saveStoredSettings("account-a", { mode: "dark" });
  saveStoredSettings("account-b", { mode: "light" });
  storage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ mode: "system" }));

  clearStoredSettings("account-a");

  assert.equal(storage.getItem(settingsKey("account-a")), null);
  assert.notEqual(storage.getItem(settingsKey("account-b")), null);
  assert.notEqual(storage.getItem(LEGACY_SETTINGS_KEY), null);

  saveStoredSettings(null, { mode: "dark" });
  storage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ mode: "system" }));
  clearStoredSettings(null);
  assert.equal(storage.getItem(settingsKey(null)), null);
  assert.equal(storage.getItem(LEGACY_SETTINGS_KEY), null);
  assert.notEqual(storage.getItem(settingsKey("account-b")), null);
});

test("workspace and location records use the same guest-only migration boundary", () => {
  const legacyWorkspace = JSON.stringify({ project: "Private legacy workspace" });
  storage.setItem(WORKSPACE_DEFAULTS_KEY_BASE, legacyWorkspace);

  assert.equal(
    loadPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, "account-a", {
      migrateLegacyGuest: true,
    }),
    null,
  );
  assert.deepEqual(storage.reads, [principalStorageKey(WORKSPACE_DEFAULTS_KEY_BASE, "account-a")]);
  assert.equal(storage.getItem(WORKSPACE_DEFAULTS_KEY_BASE), legacyWorkspace);

  assert.deepEqual(
    loadPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, null, {
      migrateLegacyGuest: true,
    }),
    { project: "Private legacy workspace" },
  );
  assert.equal(storage.getItem(WORKSPACE_DEFAULTS_KEY_BASE), null);
  assert.equal(
    storage.getItem(principalStorageKey(WORKSPACE_DEFAULTS_KEY_BASE, null)),
    legacyWorkspace,
  );
});

test("preference cleanup removes workspace and location only for the current principal", () => {
  saveStoredSettings("account-a", { mode: "dark" });
  savePrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, "account-a", { project: "A" });
  savePrincipalStoredRecord(LOCATION_KEY_BASE, "account-a", { enabled: true, lat: 1, lon: 2 });
  saveStoredSettings("account-b", { mode: "light" });
  savePrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, "account-b", { project: "B" });
  savePrincipalStoredRecord(LOCATION_KEY_BASE, "account-b", { enabled: true, lat: 3, lon: 4 });

  clearPrincipalPreferences("account-a");

  assert.equal(storage.getItem(settingsKey("account-a")), null);
  assert.equal(
    storage.getItem(principalStorageKey(WORKSPACE_DEFAULTS_KEY_BASE, "account-a")),
    null,
  );
  assert.equal(storage.getItem(principalStorageKey(LOCATION_KEY_BASE, "account-a")), null);
  assert.notEqual(storage.getItem(settingsKey("account-b")), null);
  assert.notEqual(
    storage.getItem(principalStorageKey(WORKSPACE_DEFAULTS_KEY_BASE, "account-b")),
    null,
  );
  assert.notEqual(storage.getItem(principalStorageKey(LOCATION_KEY_BASE, "account-b")), null);
});
