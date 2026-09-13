import { MEMORY_SOURCES_CHANGED_EVENT } from "./memory-sources.mjs";

let currentPrincipal = null;
let writesEnabled = false;
let generation = 0;
let deletionPrincipal = null;
let writeTail = Promise.resolve();
const BLOCK_KEY_PREFIX = "kova-memory-write-block-v1";

function normalizePrincipal(principal) {
  return typeof principal === "string" && principal.trim() ? principal : null;
}

export function memoryWriteBlockStorageKey(principal) {
  const normalized = normalizePrincipal(principal);
  return normalized ? `${BLOCK_KEY_PREFIX}:v2:user:${encodeURIComponent(normalized)}` : null;
}

export function isMemoryWriteBlocked(principal) {
  const key = memoryWriteBlockStorageKey(principal);
  if (!key || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // If shared browser storage is unavailable, the in-page coordinator still
    // enforces consent and serialization.
    return false;
  }
}

export function blockMemoryWrites(principal) {
  const normalized = normalizePrincipal(principal);
  const key = memoryWriteBlockStorageKey(normalized);
  if (key && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* The in-page block below remains authoritative for this page. */
    }
  }
  if (normalized && currentPrincipal === normalized) {
    writesEnabled = false;
    generation += 1;
  }
}

export function allowMemoryWrites(principal) {
  const key = memoryWriteBlockStorageKey(principal);
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* The caller will still fail closed when the marker cannot be removed. */
  }
}

async function withPrincipalLock(principal, run) {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager || typeof lockManager.request !== "function") return run();
  return lockManager.request(
    `kova-memory-write:${encodeURIComponent(principal)}`,
    { mode: "exclusive" },
    run,
  );
}

/**
 * Keep browser memory writes bound to the currently resolved account and
 * consent state. Disabling or changing principals invalidates work that has
 * not started yet; a write that already started remains in the serialized
 * tail so deletion can wait for it before removing durable summaries.
 */
export function configureMemoryWrites({ principal, enabled }) {
  const normalized = normalizePrincipal(principal);
  const principalChanged = normalized !== currentPrincipal;
  const nextEnabled = Boolean(
    normalized && enabled && deletionPrincipal !== normalized && !isMemoryWriteBlocked(normalized),
  );

  if (principalChanged || !nextEnabled) generation += 1;
  currentPrincipal = normalized;
  writesEnabled = nextEnabled;

  return { principal: currentPrincipal, enabled: writesEnabled };
}

export function enqueueMemoryWrite({ principal, run }) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  const normalized = normalizePrincipal(principal);
  const ticket = generation;

  const task = writeTail.then(async () => {
    if (
      !normalized ||
      !writesEnabled ||
      deletionPrincipal === normalized ||
      currentPrincipal !== normalized ||
      ticket !== generation
    ) {
      return "skipped";
    }
    return withPrincipalLock(normalized, async () => {
      // Re-check inside the origin-wide lock. Another tab may have started a
      // privacy deletion after this work was queued.
      if (
        !writesEnabled ||
        deletionPrincipal === normalized ||
        currentPrincipal !== normalized ||
        ticket !== generation ||
        isMemoryWriteBlocked(normalized)
      ) {
        return "skipped";
      }
      await run();
      return "written";
    });
  });

  // A rejected best-effort summary must not poison later writes or privacy
  // deletion. Callers still receive the original rejection from `task`.
  writeTail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/**
 * Block new work, drain the serialized write tail, then delete. This ordering
 * prevents a summary that was already in flight from recreating memory after
 * the DELETE succeeds.
 */
export async function deleteSavedMemoryAfterDraining({ principal, run }) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  const normalized = normalizePrincipal(principal);
  if (!normalized || currentPrincipal !== normalized) return "skipped";

  blockMemoryWrites(normalized);
  deletionPrincipal = normalized;
  writesEnabled = false;
  generation += 1;
  const pendingWrites = writeTail;

  try {
    await pendingWrites;
    if (currentPrincipal !== normalized) return "skipped";
    return await withPrincipalLock(normalized, async () => {
      if (currentPrincipal !== normalized) return "skipped";
      await run();
      globalThis.window?.dispatchEvent?.(new Event(MEMORY_SOURCES_CHANGED_EVENT));
      return "deleted";
    });
  } finally {
    if (deletionPrincipal === normalized) deletionPrincipal = null;
    // Deletion intentionally leaves memory disabled. The user must explicitly
    // turn it back on after the operation finishes.
    if (currentPrincipal === normalized) writesEnabled = false;
  }
}

export function getMemoryWriteCoordinatorState() {
  return {
    principal: currentPrincipal,
    enabled: writesEnabled,
    deleting: deletionPrincipal,
    generation,
  };
}

export function resetMemoryWriteCoordinatorForTests() {
  currentPrincipal = null;
  writesEnabled = false;
  generation = 0;
  deletionPrincipal = null;
  writeTail = Promise.resolve();
}
