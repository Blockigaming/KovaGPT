import assert from "node:assert/strict";
import test from "node:test";

import {
  browserStoragePrincipal,
  clearPrincipalBrowserStorage,
  consumePrincipalHandoff,
  createPrincipalHandoffEnvelope,
  DEVICE_PREFERENCE_KEYS,
  dispatchPrincipalBrowserStorageCleared,
  isPrincipalBrowserStorageClearedEvent,
  listPrincipalBrowserStorageKeys,
  parsePrincipalHandoffEnvelope,
  purgeUnscopedPrivateBrowserStorage,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "../../src/lib/principal-browser-storage.mjs";

class MemoryStorage {
  #values = new Map();
  #failOnRemove;
  #failOnSet;

  constructor(entries = [], { failOnRemove = null, failOnSet = null } = {}) {
    this.#values = new Map(entries);
    this.#failOnRemove = failOnRemove;
    this.#failOnSet = failOnSet;
  }

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.#failOnSet) throw new Error("storage denied");
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    if (key === this.#failOnRemove) throw new Error("storage denied");
    this.#values.delete(key);
  }

  has(key) {
    return this.#values.has(key);
  }
}

test("principal identity never treats unresolved auth as guest", () => {
  assert.equal(browserStoragePrincipal(undefined), null);
  assert.equal(browserStoragePrincipal(null), "guest");
  assert.equal(browserStoragePrincipal("account/a"), "user:account%2Fa");
  assert.equal(browserStoragePrincipal(""), null);
  assert.equal(principalScopedStorageKey("kova-example", undefined), null);
  assert.equal(principalScopedStorageKey("kova-example", null), "kova-example:v2:guest");
  assert.equal(
    principalScopedStorageKey("kova-example", "account/a"),
    "kova-example:v2:user:account%2Fa",
  );
});

test("account cleanup removes only A plus unscoped private state", () => {
  const local = new MemoryStorage([
    ["nova-gpt-conversations-v3:user:A", "malformed-but-removable"],
    ["nova-gpt-conversations-v3:user:B", "b"],
    ["nova-gpt-conversations-v3:guest", "guest"],
    ["nova-gpt-settings-v1:A", "a-settings"],
    ["nova-gpt-settings-v1:B", "b-settings"],
    ["nova-gpt-settings-v1:guest", "guest-settings"],
    ["kova-draft-v2:user:A:chat-1", "a-draft"],
    ["kova-draft-v2:user:B:chat-1", "b-draft"],
    ["kova-draft-v2:guest:chat-1", "guest-draft"],
    ["kova-work-tasks-v2:user:A", "a-work"],
    ["kova-work-sessions-v1:user:A", "a-session"],
    ["kova-work-tasks-v2:user:B", "b-work"],
    ["kova-work-sessions-v1:user:B", "b-session"],
    ["kova-composer-send-on-enter-v1:A", "1"],
    ["kova-composer-send-on-enter-v1:B", "0"],
    ["kova-linked-accounts:A", "a-linked"],
    ["kova-linked-accounts:B", "b-linked"],
    ["kova-workspace-snapshots-v1:A", "a-snapshots"],
    ["kova-workspace-snapshots-v1:B", "b-snapshots"],
    ["kova-omega:A:enterprise", "a-omega"],
    ["kova-omega:B:enterprise", "b-omega"],
    ["novagpt-image-history-A", "a-images"],
    ["novagpt-image-history-B", "b-images"],
    ["kova-command-history-v1:v2:user:A", '["/work"]'],
    ["kova-command-history-v1:v2:user:B", '["/library"]'],
    ["kova-command-history-v1", '["/private-ownerless"]'],
    ["kova.write.draft.v1", "ownerless-private-draft"],
    ["kova-feedback:message-1", "up"],
    ["nova-gpt-conversations-v2", "guest-legacy-chat"],
    ["kova-workspace-defaults-v1", "guest-legacy-preference"],
    ...DEVICE_PREFERENCE_KEYS.map((key) => [key, "device"]),
  ]);
  const session = new MemoryStorage([
    ["kova-prompt-launch:v2:user:A", "a-prompt"],
    ["kova-prompt-launch:v2:user:B", "b-prompt"],
    ["kova-prompt-launch:v2:guest", "guest-prompt"],
    ["kova-prompt-launch", "ownerless-prompt"],
    ["unrelated-session", "keep"],
  ]);

  const result = clearPrincipalBrowserStorage("A", {
    localStorage: local,
    sessionStorage: session,
  });

  assert.equal(result.resolved, true);
  assert.equal(result.principal, "user:A");
  for (const key of [
    "nova-gpt-conversations-v3:user:A",
    "nova-gpt-settings-v1:A",
    "kova-draft-v2:user:A:chat-1",
    "kova-work-tasks-v2:user:A",
    "kova-work-sessions-v1:user:A",
    "kova-composer-send-on-enter-v1:A",
    "kova-linked-accounts:A",
    "kova-workspace-snapshots-v1:A",
    "kova-omega:A:enterprise",
    "novagpt-image-history-A",
    "kova-command-history-v1:v2:user:A",
    "kova-command-history-v1",
    "kova.write.draft.v1",
    "kova-feedback:message-1",
  ]) {
    assert.equal(local.has(key), false, `${key} should be removed`);
  }
  for (const key of [
    "nova-gpt-conversations-v3:user:B",
    "nova-gpt-conversations-v3:guest",
    "nova-gpt-settings-v1:B",
    "nova-gpt-settings-v1:guest",
    "kova-draft-v2:user:B:chat-1",
    "kova-draft-v2:guest:chat-1",
    "kova-work-tasks-v2:user:B",
    "kova-work-sessions-v1:user:B",
    "kova-composer-send-on-enter-v1:B",
    "kova-linked-accounts:B",
    "kova-workspace-snapshots-v1:B",
    "kova-omega:B:enterprise",
    "novagpt-image-history-B",
    "kova-command-history-v1:v2:user:B",
    "nova-gpt-conversations-v2",
    "kova-workspace-defaults-v1",
    ...DEVICE_PREFERENCE_KEYS,
  ]) {
    assert.equal(local.has(key), true, `${key} should be preserved`);
  }
  assert.equal(session.has("kova-prompt-launch:v2:user:A"), false);
  assert.equal(session.has("kova-prompt-launch"), false);
  assert.equal(session.has("kova-prompt-launch:v2:user:B"), true);
  assert.equal(session.has("kova-prompt-launch:v2:guest"), true);
  assert.equal(session.has("unrelated-session"), true);
});

test("confirmed guest cleanup removes guest scoped and guest legacy data", () => {
  const local = new MemoryStorage([
    ["nova-gpt-conversations-v3:guest", "guest"],
    ["nova-gpt-conversations-v3:user:A", "a"],
    ["nova-gpt-conversations-v2", "legacy-guest"],
    ["kova-draft:__new__", "legacy-guest-draft"],
    ["kova-draft-v2:guest:__new__", "guest-draft"],
    ["kova-draft-v2:user:A:__new__", "a-draft"],
    ["kova-guest-library", "guest-library"],
    ["kova-sidebar-open", "1"],
  ]);
  const session = new MemoryStorage([
    ["kova-active-context-pack:v2:guest", "guest-pack"],
    ["kova-active-context-pack:v2:user:A", "a-pack"],
  ]);

  const result = clearPrincipalBrowserStorage(null, {
    localStorage: local,
    sessionStorage: session,
  });

  assert.equal(result.principal, "guest");
  assert.equal(local.has("nova-gpt-conversations-v3:guest"), false);
  assert.equal(local.has("nova-gpt-conversations-v2"), false);
  assert.equal(local.has("kova-draft:__new__"), false);
  assert.equal(local.has("kova-draft-v2:guest:__new__"), false);
  assert.equal(local.has("kova-guest-library"), false);
  assert.equal(local.has("nova-gpt-conversations-v3:user:A"), true);
  assert.equal(local.has("kova-draft-v2:user:A:__new__"), true);
  assert.equal(local.has("kova-sidebar-open"), true);
  assert.equal(session.has("kova-active-context-pack:v2:guest"), false);
  assert.equal(session.has("kova-active-context-pack:v2:user:A"), true);
});

test("unresolved auth is a storage-free no-op", () => {
  let accesses = 0;
  const unavailable = {
    get length() {
      accesses += 1;
      throw new Error("must not enumerate");
    },
    key() {
      accesses += 1;
      throw new Error("must not key");
    },
    getItem() {
      accesses += 1;
      throw new Error("must not read");
    },
    removeItem() {
      accesses += 1;
      throw new Error("must not remove");
    },
  };

  const result = clearPrincipalBrowserStorage(undefined, {
    localStorage: unavailable,
    sessionStorage: unavailable,
  });
  assert.equal(result.resolved, false);
  assert.equal(result.reason, "auth_unresolved");
  assert.equal(accesses, 0);
  assert.equal(listPrincipalBrowserStorageKeys(undefined), null);
});

test("safe storage resolution catches throwing global getters", () => {
  let accesses = 0;
  const target = {};
  Object.defineProperty(target, "sessionStorage", {
    get() {
      accesses += 1;
      throw new Error("denied");
    },
  });
  assert.equal(safeBrowserStorage("sessionStorage", target), null);
  assert.equal(accesses, 1);
  assert.equal(safeBrowserStorage("invalid", target), null);
  assert.equal(accesses, 1);
  assert.equal(
    safeBrowserStorage("localStorage", {
      localStorage: { getItem() {}, removeItem() {} },
    }),
    null,
    "partial storage objects must not escape as writable Storage instances",
  );
});

test("first resolution purge removes ownerless data without deleting guest or incoming user", () => {
  const local = new MemoryStorage([
    ["kova-prompt-studio-draft-v1", "ownerless"],
    ["kova-prompt-studio-draft:v2:guest", "guest"],
    ["kova-prompt-studio-draft:v2:user:A", "account-a"],
    ["kova-prompt-studio-draft:v2:user:B", "account-b"],
  ]);
  const session = new MemoryStorage([
    ["kova-prompt-launch", "ownerless"],
    ["kova-prompt-launch:v2:guest", "guest"],
    ["kova-prompt-launch:v2:user:A", "account-a"],
  ]);

  const result = purgeUnscopedPrivateBrowserStorage("A", {
    localStorage: local,
    sessionStorage: session,
  });
  assert.equal(result.resolved, true);
  assert.equal(local.has("kova-prompt-studio-draft-v1"), false);
  assert.equal(session.has("kova-prompt-launch"), false);
  for (const key of [
    "kova-prompt-studio-draft:v2:guest",
    "kova-prompt-studio-draft:v2:user:A",
    "kova-prompt-studio-draft:v2:user:B",
  ]) {
    assert.equal(local.has(key), true, `${key} must survive purge-only resolution`);
  }
  assert.equal(session.has("kova-prompt-launch:v2:guest"), true);
  assert.equal(session.has("kova-prompt-launch:v2:user:A"), true);
});

test("one storage failure does not stop remaining exact cleanup", () => {
  const blockedKey = "nova-gpt-conversations-v3:user:A";
  const local = new MemoryStorage(
    [
      [blockedKey, "blocked"],
      ["nova-gpt-settings-v1:A", "remove-me"],
    ],
    { failOnRemove: blockedKey },
  );

  const result = clearPrincipalBrowserStorage("A", {
    localStorage: local,
    sessionStorage: null,
  });
  assert.equal(local.has(blockedKey), true);
  assert.equal(local.has("nova-gpt-settings-v1:A"), false);
  assert.ok(result.local.failures.includes(`local:${blockedKey}`));
  assert.deepEqual(result.session.failures, ["session:unavailable"]);
});

test("handoff envelopes enforce principal, age, size, and schema", () => {
  const now = 10_000;
  const envelope = createPrincipalHandoffEnvelope("A", { prompt: "hello" }, now);
  assert.deepEqual(parsePrincipalHandoffEnvelope(JSON.stringify(envelope), "A", { now }), {
    ok: true,
    value: { prompt: "hello" },
    createdAt: now,
  });
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify(envelope), "B", { now }).reason,
    "principal_mismatch",
  );
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify(envelope), undefined, { now }).reason,
    "auth_unresolved",
  );
  assert.equal(parsePrincipalHandoffEnvelope("{", "A", { now }).reason, "malformed");
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify({ prompt: "legacy" }), "A", { now }).reason,
    "legacy_unscoped",
  );
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify(envelope), "A", {
      now: now + 1_001,
      maxAgeMs: 1_000,
    }).reason,
    "expired",
  );
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify(envelope), "A", {
      now,
      maxBytes: 8,
    }).reason,
    "oversized",
  );
  assert.equal(
    parsePrincipalHandoffEnvelope(JSON.stringify({ ...envelope, version: 99 }), "A", { now })
      .reason,
    "unsupported_version",
  );
  assert.equal(createPrincipalHandoffEnvelope(undefined, {}, now), null);
});

test("scoped handoff helpers write, consume once, and never inspect ownerless keys", () => {
  const now = 25_000;
  const storage = new MemoryStorage([["kova-prompt-launch", '{"prompt":"legacy"}']]);
  const written = writePrincipalHandoff(
    storage,
    "kova-prompt-launch",
    "A",
    { prompt: "hello" },
    { now },
  );
  assert.deepEqual(written, {
    ok: true,
    key: "kova-prompt-launch:v2:user:A",
    createdAt: now,
  });

  assert.deepEqual(consumePrincipalHandoff(storage, "kova-prompt-launch", "A", { now }), {
    ok: true,
    value: { prompt: "hello" },
    createdAt: now,
    key: "kova-prompt-launch:v2:user:A",
  });
  assert.equal(storage.has("kova-prompt-launch:v2:user:A"), false);
  assert.equal(storage.has("kova-prompt-launch"), true, "ownerless legacy value is never read");
  assert.equal(
    consumePrincipalHandoff(storage, "kova-prompt-launch", "A", { now }).reason,
    "missing",
  );
});

test("scoped handoff consumers reject mismatched, legacy, expired, and oversized values", () => {
  const now = 40_000;
  const keyB = principalScopedStorageKey("kova-work-context", "B");
  const storage = new MemoryStorage([
    [keyB, JSON.stringify(createPrincipalHandoffEnvelope("A", { objective: "private" }, now))],
  ]);
  assert.equal(
    consumePrincipalHandoff(storage, "kova-work-context", "B", { now }).reason,
    "principal_mismatch",
  );
  assert.equal(storage.has(keyB), false, "rejected values are one-shot too");

  const keyA = principalScopedStorageKey("kova-work-context", "A");
  storage.setItem(keyA, JSON.stringify({ objective: "legacy" }));
  assert.equal(
    consumePrincipalHandoff(storage, "kova-work-context", "A", { now }).reason,
    "legacy_unscoped",
  );

  storage.setItem(
    keyA,
    JSON.stringify(createPrincipalHandoffEnvelope("A", { objective: "old" }, now - 2_000)),
  );
  assert.equal(
    consumePrincipalHandoff(storage, "kova-work-context", "A", {
      now,
      maxAgeMs: 1_000,
    }).reason,
    "expired",
  );

  assert.equal(
    writePrincipalHandoff(storage, "kova-work-context", "A", "too large", {
      now,
      maxBytes: 8,
    }).reason,
    "oversized",
  );
});

test("handoff I/O fails closed and unresolved auth performs no storage access", () => {
  let accesses = 0;
  const forbidden = {
    getItem() {
      accesses += 1;
      throw new Error("must not read");
    },
    removeItem() {
      accesses += 1;
      throw new Error("must not remove");
    },
    setItem() {
      accesses += 1;
      throw new Error("must not write");
    },
  };
  assert.equal(
    writePrincipalHandoff(forbidden, "kova-work-context", undefined, {}).reason,
    "auth_unresolved",
  );
  assert.equal(
    consumePrincipalHandoff(forbidden, "kova-work-context", undefined).reason,
    "auth_unresolved",
  );
  assert.equal(accesses, 0);

  const key = principalScopedStorageKey("kova-work-context", "A");
  const removeBlocked = new MemoryStorage(
    [[key, JSON.stringify(createPrincipalHandoffEnvelope("A", {}, 10))]],
    { failOnRemove: key },
  );
  assert.equal(
    consumePrincipalHandoff(removeBlocked, "kova-work-context", "A", { now: 10 }).reason,
    "storage_remove_failed",
  );
});

test("principal cleanup events match only their resolved principal", () => {
  let dispatched = null;
  class TestCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const target = {
    CustomEvent: TestCustomEvent,
    dispatchEvent(event) {
      dispatched = event;
      return true;
    },
  };

  assert.equal(dispatchPrincipalBrowserStorageCleared("A", target), true);
  assert.equal(dispatched.type, PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT);
  assert.equal(isPrincipalBrowserStorageClearedEvent(dispatched, "A"), true);
  assert.equal(isPrincipalBrowserStorageClearedEvent(dispatched, "B"), false);
  assert.equal(isPrincipalBrowserStorageClearedEvent(dispatched, null), false);
  assert.equal(dispatchPrincipalBrowserStorageCleared(undefined, target), false);
});
