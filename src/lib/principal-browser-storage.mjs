const MAX_USER_KEY_LENGTH = 512;
const MAX_ENUMERATED_STORAGE_KEYS = 20_000;

export const PRINCIPAL_HANDOFF_VERSION = 1;
export const DEFAULT_HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;
export const DEFAULT_HANDOFF_MAX_BYTES = 128 * 1024;
export const PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT = "kova:principal-browser-storage-cleared";

/**
 * These bases use `${base}:v2:${principal}`. Feature modules should use the
 * exported key builder instead of assembling browser-storage keys themselves.
 */
export const PRINCIPAL_LOCAL_STORAGE_BASES = Object.freeze([
  "kova-workspace-defaults-v1",
  "kova-location",
  "kova-memory-write-block-v1",
  "kova-write-draft",
  "kova-write-title",
  "kova-prompt-studio-draft",
  "kova-library-favorites",
  "kovagpt-saved-message-ids",
  "kova-message-feedback",
  "kova-personality",
  "kova-personality-auto-adapt",
  "kova-shortcuts",
  "kova-app-activity",
  "kova-timers",
  "kova-summary-dismissed",
  "kova-weather-opt-in",
  "kova-command-history-v1",
  "kova-command-pins-v1",
]);

export const PRINCIPAL_SESSION_STORAGE_BASES = Object.freeze([
  "kova-context-candidates",
  "kova-active-context-pack",
  "kova-app-chat-context",
  "kova-prompt-launch",
  "kova-research-launch",
  "kova-work-context",
  "kova-automation-draft",
  "kova-research-draft",
  "kova-work-draft",
]);

/** Device policy/UI state intentionally survives account-local cleanup. */
export const DEVICE_PREFERENCE_KEYS = Object.freeze([
  "nova-gpt-theme",
  "kova-theme-mode",
  "kova-sidebar-open",
  "kova-library-view",
]);

// Older and not-yet-scoped feature paths wrote these private values without a
// principal. Scoped handoff and command code never reads the legacy variants.
// Purge ownerless values on every resolved identity cleanup so stale data
// cannot be handed to the next account on the same browser.
const UNSCOPED_PRIVATE_LOCAL_EXACT_KEYS = Object.freeze([
  "kova.write.draft.v1",
  "kova.write.title.v1",
  "kova-prompt-studio-draft-v1",
  "kova-research-draft",
  "kova-research-launch",
  "kova-work-draft",
  "kova-work-context",
  "kova-automation-draft",
  "kova-context-candidates",
  "kova-context-candidate",
  "kova-active-context-pack",
  "kova-app-chat-context",
  "kova-prompt-launch",
  "kova-app-activity-v1",
  "kova-library-favorites",
  "kovagpt:savedMessageIds",
  "kova.personality.v1",
  "kova.personality.autoAdapt.v1",
  "kova-shortcuts-v1",
  "kova-command-history-v1",
  "kova-command-pins-v1",
  "kova-timers-v1",
  "kova-summary-dismissed-v1",
  "kova-weather-opt-in",
]);

const UNSCOPED_PRIVATE_LOCAL_PREFIXES = Object.freeze(["kova-feedback:"]);

const UNSCOPED_PRIVATE_SESSION_EXACT_KEYS = Object.freeze([
  "kova-context-candidates",
  "kova-context-candidate",
  "kova-active-context-pack",
  "kova-app-chat-context",
  "kova-prompt-launch",
  "kova-research-launch",
  "kova-work-context",
  "kova-automation-draft",
  "kova-research-draft",
  "kova-work-draft",
  "kovagpt:post-auth-redirect",
  "kovagpt:password-recovery-started",
]);

// These values were explicitly classified as guest-owned by earlier storage
// migrations. A signed-in account must never delete or claim them.
const GUEST_LEGACY_LOCAL_EXACT_KEYS = Object.freeze([
  "nova-gpt-conversations-v2",
  "kovagpt:archived",
  "nova-gpt-pending-active",
  "nova-gpt-settings-v1",
  "kova-workspace-defaults-v1",
  "kova-location",
  "kova-memory-write-block-v1",
  "kova-work-tasks-v1",
  "kova-work-templates-v1",
  "kova-agent-workspace-v1",
  "kova-guest-library",
]);

const GUEST_LEGACY_LOCAL_PREFIXES = Object.freeze(["kova-draft:"]);

function storagePrincipal(userKey) {
  if (userKey === undefined) return null;
  if (userKey === null) return { principal: "guest", userKey: null };
  if (typeof userKey !== "string" || userKey.length === 0 || userKey.length > MAX_USER_KEY_LENGTH) {
    return null;
  }
  return { principal: `user:${encodeURIComponent(userKey)}`, userKey };
}

export function browserStoragePrincipal(userKey) {
  return storagePrincipal(userKey)?.principal ?? null;
}

export function principalScopedStorageKey(baseKey, userKey) {
  if (typeof baseKey !== "string" || baseKey.length === 0) return null;
  const identity = storagePrincipal(userKey);
  return identity ? `${baseKey}:v2:${identity.principal}` : null;
}

/**
 * Browser storage getters can throw before a helper receives the Storage
 * object (privacy mode, sandboxed frames, or a hostile test getter). Resolve
 * them inside this boundary so every caller can fail closed.
 */
export function safeBrowserStorage(area, target) {
  if (area !== "localStorage" && area !== "sessionStorage") return null;
  try {
    const owner = arguments.length >= 2 ? target : typeof window === "undefined" ? null : window;
    const storage = owner?.[area] ?? null;
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" ||
      typeof storage.removeItem !== "function"
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

export function createPrincipalHandoffEnvelope(userKey, payload, now = Date.now()) {
  const identity = storagePrincipal(userKey);
  if (!identity || !Number.isFinite(now) || now < 0) return null;
  return {
    version: PRINCIPAL_HANDOFF_VERSION,
    principal: identity.principal,
    createdAt: now,
    payload,
  };
}

function utf8Length(value) {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length;
  }
}

export function parsePrincipalHandoffEnvelope(raw, userKey, options = {}) {
  const identity = storagePrincipal(userKey);
  if (!identity) return { ok: false, reason: "auth_unresolved" };
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "missing" };
  if (typeof raw !== "string") return { ok: false, reason: "malformed" };

  const maxBytes = options.maxBytes ?? DEFAULT_HANDOFF_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || utf8Length(raw) > maxBytes) {
    return { ok: false, reason: "oversized" };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed" };
  }
  if (!("version" in parsed) || !("principal" in parsed)) {
    return { ok: false, reason: "legacy_unscoped" };
  }
  if (parsed.version !== PRINCIPAL_HANDOFF_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }
  if (parsed.principal !== identity.principal) {
    return { ok: false, reason: "principal_mismatch" };
  }

  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_HANDOFF_MAX_AGE_MS;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0 ||
    !Number.isFinite(parsed.createdAt) ||
    parsed.createdAt < 0 ||
    parsed.createdAt > now + 5 * 60 * 1000
  ) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (now - parsed.createdAt > maxAgeMs) return { ok: false, reason: "expired" };
  if (!("payload" in parsed)) return { ok: false, reason: "malformed" };

  return { ok: true, value: parsed.payload, createdAt: parsed.createdAt };
}

/**
 * Persist a one-shot handoff only after authentication has resolved. Handoff
 * producers should use this helper instead of writing an ownerless value.
 */
export function writePrincipalHandoff(storage, baseKey, userKey, payload, options = {}) {
  const key = principalScopedStorageKey(baseKey, userKey);
  const now = options.now ?? Date.now();
  const envelope = createPrincipalHandoffEnvelope(userKey, payload, now);
  if (!key || !envelope) return { ok: false, reason: "auth_unresolved" };
  if (!storage || typeof storage.setItem !== "function") {
    return { ok: false, reason: "storage_unavailable" };
  }

  let raw;
  try {
    raw = JSON.stringify(envelope);
  } catch {
    return { ok: false, reason: "payload_unserializable" };
  }
  if (typeof raw !== "string") return { ok: false, reason: "payload_unserializable" };

  const maxBytes = options.maxBytes ?? DEFAULT_HANDOFF_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || utf8Length(raw) > maxBytes) {
    return { ok: false, reason: "oversized" };
  }

  try {
    storage.setItem(key, raw);
  } catch {
    return { ok: false, reason: "storage_write_failed" };
  }
  return { ok: true, key, createdAt: envelope.createdAt };
}

/**
 * Read and remove one scoped handoff before validating it. Removal-before-use
 * prevents a valid or invalid value from replaying after a remount.
 */
export function consumePrincipalHandoff(storage, baseKey, userKey, options = {}) {
  const key = principalScopedStorageKey(baseKey, userKey);
  if (!key) return { ok: false, reason: "auth_unresolved" };
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return { ok: false, reason: "storage_unavailable" };
  }

  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, reason: "storage_read_failed" };
  }
  try {
    storage.removeItem(key);
  } catch {
    return { ok: false, reason: "storage_remove_failed" };
  }

  const parsed = parsePrincipalHandoffEnvelope(raw, userKey, options);
  return parsed.ok ? { ...parsed, key } : parsed;
}

export function isPrincipalBrowserStorageClearedEvent(event, userKey) {
  const principal = browserStoragePrincipal(userKey);
  return (
    principal !== null &&
    Boolean(event) &&
    typeof event === "object" &&
    event.detail?.principal === principal
  );
}

/** Notify mounted principal stores after durable cleanup so stale React state cannot rewrite it. */
export function dispatchPrincipalBrowserStorageCleared(
  userKey,
  target = globalThis.window ?? null,
) {
  const principal = browserStoragePrincipal(userKey);
  const EventConstructor = target?.CustomEvent ?? globalThis.CustomEvent;
  if (
    principal === null ||
    !target ||
    typeof target.dispatchEvent !== "function" ||
    typeof EventConstructor !== "function"
  ) {
    return false;
  }
  try {
    target.dispatchEvent(
      new EventConstructor(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, {
        detail: { principal },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function principalKeyPlan(identity, { purgeUnscopedPrivate = true } = {}) {
  const { principal, userKey } = identity;
  const localExact = [
    `nova-gpt-conversations-v3:${principal}`,
    `kovagpt:archived:v2:${principal}`,
    `nova-gpt-pending-active:v2:${principal}`,
    `nova-gpt-settings-v1:${userKey ?? "guest"}`,
    `kova-work-tasks-v2:${principal}`,
    `kova-work-sessions-v1:${principal}`,
    `kova-work-templates-v2:${principal}`,
    `kova-agent-workspace-v2:${principal}`,
    `kova-work-sync-v1:${principal}`,
    `kova-composer-send-on-enter-v1:${userKey ?? "guest"}`,
    `kova-workspace-snapshots-v1:${userKey ?? "signed-out"}`,
    `kova-omega:${userKey ?? "signed-out"}:enterprise`,
    `kova-omega:${userKey ?? "signed-out"}:mcp`,
    `kova-omega:${userKey ?? "signed-out"}:agents`,
    `kova-omega:${userKey ?? "signed-out"}:pipeline`,
    ...PRINCIPAL_LOCAL_STORAGE_BASES.map((base) => `${base}:v2:${principal}`),
  ];
  if (userKey !== null) {
    localExact.push(`novagpt-image-history-${userKey}`, `kova-linked-accounts:${userKey}`);
  }
  if (userKey === null) localExact.push(...GUEST_LEGACY_LOCAL_EXACT_KEYS);
  if (purgeUnscopedPrivate) localExact.push(...UNSCOPED_PRIVATE_LOCAL_EXACT_KEYS);

  const localPrefixes = [
    `kova-draft-v2:${principal}:`,
    `${principalScopedStorageKey("kova-message-feedback", userKey)}:`,
  ];
  if (userKey === null) localPrefixes.push(...GUEST_LEGACY_LOCAL_PREFIXES);
  if (purgeUnscopedPrivate) localPrefixes.push(...UNSCOPED_PRIVATE_LOCAL_PREFIXES);

  const sessionExact = PRINCIPAL_SESSION_STORAGE_BASES.map((base) => `${base}:v2:${principal}`);
  if (purgeUnscopedPrivate) sessionExact.push(...UNSCOPED_PRIVATE_SESSION_EXACT_KEYS);

  return {
    localExact: [...new Set(localExact)],
    localPrefixes: [...new Set(localPrefixes)],
    sessionExact: [...new Set(sessionExact)],
  };
}

export function listPrincipalBrowserStorageKeys(userKey, options = {}) {
  const identity = storagePrincipal(userKey);
  if (!identity) return null;
  return { principal: identity.principal, ...principalKeyPlan(identity, options) };
}

function defaultStorage(name) {
  return safeBrowserStorage(name);
}

function storageSnapshot(storage, prefixes, failures, area) {
  if (!prefixes.length) return [];
  const keys = [];
  try {
    const length = storage.length;
    const count = Math.min(length, MAX_ENUMERATED_STORAGE_KEYS);
    for (let index = 0; index < count; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    if (length > MAX_ENUMERATED_STORAGE_KEYS) failures.push(`${area}:enumeration_truncated`);
  } catch {
    failures.push(`${area}:enumeration_failed`);
  }
  return [...new Set(keys)];
}

function clearStorageArea(storage, exactKeys, prefixes, area) {
  const result = {
    available: Boolean(storage),
    removed: [],
    failures: storage ? [] : [`${area}:unavailable`],
  };
  if (!storage) return result;

  const targets = [
    ...new Set([...exactKeys, ...storageSnapshot(storage, prefixes, result.failures, area)]),
  ];
  for (const key of targets) {
    try {
      const existed = storage.getItem(key) !== null;
      storage.removeItem(key);
      if (existed) result.removed.push(key);
    } catch {
      result.failures.push(`${area}:${key}`);
    }
  }
  return result;
}

/**
 * Remove exactly one resolved principal's registered browser data. Passing
 * `undefined` is an auth-not-loaded no-op; only `null` means confirmed guest.
 */
export function clearPrincipalBrowserStorage(userKey, options = {}) {
  const identity = storagePrincipal(userKey);
  if (!identity) {
    return {
      resolved: false,
      reason: userKey === undefined ? "auth_unresolved" : "invalid_user_key",
      principal: null,
      local: { available: false, removed: [], failures: [] },
      session: { available: false, removed: [], failures: [] },
    };
  }

  const plan = principalKeyPlan(identity, options);
  const local = Object.prototype.hasOwnProperty.call(options, "localStorage")
    ? options.localStorage
    : defaultStorage("localStorage");
  const session = Object.prototype.hasOwnProperty.call(options, "sessionStorage")
    ? options.sessionStorage
    : defaultStorage("sessionStorage");

  return {
    resolved: true,
    reason: null,
    principal: identity.principal,
    local: clearStorageArea(local, plan.localExact, plan.localPrefixes, "local"),
    session: clearStorageArea(session, plan.sessionExact, [], "session"),
  };
}

/**
 * Remove only transitional ownerless private data after an identity becomes
 * authoritative. This is deliberately separate from principal cleanup: first
 * resolution and guest-to-user transitions must not delete the incoming
 * account or the separately scoped guest workspace.
 */
export function purgeUnscopedPrivateBrowserStorage(userKey, options = {}) {
  const identity = storagePrincipal(userKey);
  if (!identity) {
    return {
      resolved: false,
      reason: userKey === undefined ? "auth_unresolved" : "invalid_user_key",
      principal: null,
      local: { available: false, removed: [], failures: [] },
      session: { available: false, removed: [], failures: [] },
    };
  }

  const local = Object.prototype.hasOwnProperty.call(options, "localStorage")
    ? options.localStorage
    : defaultStorage("localStorage");
  const session = Object.prototype.hasOwnProperty.call(options, "sessionStorage")
    ? options.sessionStorage
    : defaultStorage("sessionStorage");
  return {
    resolved: true,
    reason: null,
    principal: identity.principal,
    local: clearStorageArea(
      local,
      UNSCOPED_PRIVATE_LOCAL_EXACT_KEYS,
      UNSCOPED_PRIVATE_LOCAL_PREFIXES,
      "local",
    ),
    session: clearStorageArea(session, UNSCOPED_PRIVATE_SESSION_EXACT_KEYS, [], "session"),
  };
}
