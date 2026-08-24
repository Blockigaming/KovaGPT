// Bounded, device-only fallback for the chat workspace (edit versions, per-chat
// rules, branch labels) used when nobody is signed in.
//
// It is deliberately small and lossy-by-bound: guests get real persistence on
// this device, and the UI must label it as such. Nothing here ever claims to be
// synced to an account.

export const LOCAL_WORKSPACE_STORAGE_KEY = "kova-local-chat-workspace";

export const LOCAL_MAX_CHATS = 150;
export const LOCAL_MAX_VERSIONS_PER_MESSAGE = 40;
export const LOCAL_MAX_CONTENT_CHARS = 40_000;
export const LOCAL_MAX_RULES_CHARS = 8_000;
export const LOCAL_MAX_BRANCHES_PER_CHAT = 24;
export const LOCAL_MAX_PINS_PER_CHAT = 20;
/** Hard ceiling on the serialized guest workspace (1.5 MB). */
export const LOCAL_MAX_TOTAL_BYTES = 1_500_000;

function emptyState() {
  return { chats: {} };
}

export function parseWorkspaceState(raw) {
  if (typeof raw !== "string" || !raw) return emptyState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.chats !== "object") {
      return emptyState();
    }
    return { chats: parsed.chats ?? {} };
  } catch {
    return emptyState();
  }
}

function chatEntry(state, chatId) {
  const existing = state.chats[chatId];
  if (existing && typeof existing === "object") {
    return {
      rules: existing.rules ?? null,
      versions: existing.versions ?? {},
      branches: Array.isArray(existing.branches) ? existing.branches : [],
      pins: Array.isArray(existing.pins) ? existing.pins : [],
      touchedAt: existing.touchedAt ?? 0,
    };
  }
  return { rules: null, versions: {}, branches: [], pins: [], touchedAt: 0 };
}

/** Evict the least recently touched chats so storage stays bounded. */
function prune(state) {
  const ids = Object.keys(state.chats);
  if (ids.length <= LOCAL_MAX_CHATS) return state;
  const ordered = ids.sort(
    (a, b) => (state.chats[b]?.touchedAt ?? 0) - (state.chats[a]?.touchedAt ?? 0),
  );
  const kept = {};
  for (const id of ordered.slice(0, LOCAL_MAX_CHATS)) kept[id] = state.chats[id];
  return { chats: kept };
}

export function readWorkspace(storage) {
  if (!storage) return emptyState();
  try {
    return parseWorkspaceState(storage.getItem(LOCAL_WORKSPACE_STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

/**
 * Serialize within the total byte bound, evicting the least recently touched
 * chats until the payload fits. Returns null when even one chat is too large.
 */
function serializeBounded(state) {
  let current = prune(state);
  let payload = JSON.stringify(current);
  while (payload.length > LOCAL_MAX_TOTAL_BYTES) {
    const ids = Object.keys(current.chats);
    if (ids.length <= 1) return null;
    const oldest = ids.sort(
      (a, b) => (current.chats[a]?.touchedAt ?? 0) - (current.chats[b]?.touchedAt ?? 0),
    )[0];
    const chats = { ...current.chats };
    delete chats[oldest];
    current = { chats };
    payload = JSON.stringify(current);
  }
  return payload;
}

export function writeWorkspace(storage, state) {
  if (!storage) return false;
  const payload = serializeBounded(state);
  if (payload === null) return false;
  try {
    storage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}

function mutate(storage, chatId, fn) {
  const state = readWorkspace(storage);
  const entry = chatEntry(state, chatId);
  const next = fn(entry);
  next.touchedAt = Date.now();
  state.chats[chatId] = next;
  writeWorkspace(storage, state);
  return next;
}

/* ---------------- versions ---------------- */

export function localVersions(storage, chatId, messageId) {
  const entry = chatEntry(readWorkspace(storage), chatId);
  const list = entry.versions?.[messageId];
  return Array.isArray(list) ? list : [];
}

export function saveLocalVersion(storage, chatId, messageId, input) {
  const content = String(input?.content ?? "").slice(0, LOCAL_MAX_CONTENT_CHARS);
  if (!content.trim()) throw new Error("Edited text cannot be empty.");
  const entry = mutate(storage, chatId, (current) => {
    const list = Array.isArray(current.versions?.[messageId])
      ? current.versions[messageId].slice()
      : [];
    const version = (list[list.length - 1]?.version ?? 0) + 1;
    list.push({
      id: `local-${chatId}-${messageId}-${version}`,
      version,
      content,
      originalContent:
        typeof input?.originalContent === "string"
          ? input.originalContent.slice(0, LOCAL_MAX_CONTENT_CHARS)
          : null,
      instruction:
        typeof input?.instruction === "string" ? input.instruction.slice(0, 2_000) : null,
      source: typeof input?.source === "string" ? input.source : "inline_edit",
      createdAt: new Date().toISOString(),
      durable: false,
    });
    return {
      ...current,
      versions: {
        ...current.versions,
        [messageId]: list.slice(-LOCAL_MAX_VERSIONS_PER_MESSAGE),
      },
    };
  });
  const list = entry.versions[messageId];
  return list[list.length - 1];
}

/* ---------------- per-chat rules ---------------- */

export function localRules(storage, chatId) {
  const entry = chatEntry(readWorkspace(storage), chatId);
  return entry.rules ?? null;
}

export function saveLocalRules(storage, chatId, { instructions, enabled }) {
  const text = String(instructions ?? "");
  if (text.length > LOCAL_MAX_RULES_CHARS) {
    throw new Error(`Chat instructions must be ${LOCAL_MAX_RULES_CHARS} characters or fewer.`);
  }
  const entry = mutate(storage, chatId, (current) => ({
    ...current,
    rules: { instructions: text, enabled: enabled !== false, updatedAt: new Date().toISOString() },
  }));
  return entry.rules;
}

export function clearLocalRules(storage, chatId) {
  mutate(storage, chatId, (current) => ({ ...current, rules: null }));
  return null;
}

/* ---------------- branch labels ---------------- */

export function localBranches(storage, chatId) {
  return chatEntry(readWorkspace(storage), chatId).branches;
}

export function saveLocalBranch(storage, chatId, branch) {
  const conversationId = String(branch.conversationId ?? "").trim();
  if (!conversationId) throw new Error("A conversation is required to save a branch.");
  const entry = mutate(storage, chatId, (current) => {
    const branches = current.branches.filter(
      (item) => item.id !== branch.id && item.conversationId !== conversationId,
    );
    branches.push({
      id: String(branch.id),
      conversationId,
      label: branch.label ? String(branch.label).slice(0, 120) : null,
      branchFromMessageId: branch.branchFromMessageId ? String(branch.branchFromMessageId) : null,
      branchFromMessageIndex:
        typeof branch.branchFromMessageIndex === "number" ? branch.branchFromMessageIndex : null,
      parentBranchId: branch.parentBranchId ? String(branch.parentBranchId) : null,
      active: branch.active !== false,
      createdAt: branch.createdAt ?? new Date().toISOString(),
    });
    const normalized =
      branch.active === false
        ? branches
        : branches.map((item) => ({
            ...item,
            active: item.id === branch.id,
          }));
    return { ...current, branches: normalized.slice(-LOCAL_MAX_BRANCHES_PER_CHAT) };
  });
  return entry.branches.find((item) => item.id === branch.id) ?? null;
}

export function activateLocalBranch(storage, chatId, branchId) {
  const existing = localBranches(storage, chatId).some((item) => item.id === branchId);
  if (!existing) return null;
  const entry = mutate(storage, chatId, (current) => ({
    ...current,
    branches: current.branches.map((item) => ({ ...item, active: item.id === branchId })),
  }));
  return entry.branches.find((item) => item.id === branchId) ?? null;
}

/* ---------------- pinned sources ---------------- */

export function localPins(storage, chatId) {
  return chatEntry(readWorkspace(storage), chatId).pins;
}

export function pinLocalSource(storage, chatId, pin) {
  const sourceId = String(pin?.sourceId ?? "").trim();
  const sourceType = pin?.sourceType === "project_file" ? "project_file" : "library";
  if (!sourceId) throw new Error("A source is required to pin a file.");
  if (sourceType === "project_file" && !pin?.projectId) {
    throw new Error("A project is required to pin a project file.");
  }
  const existing = localPins(storage, chatId);
  if (
    existing.length >= LOCAL_MAX_PINS_PER_CHAT &&
    !existing.some((item) => item.sourceId === sourceId && item.sourceType === sourceType)
  ) {
    throw new Error(`You can pin up to ${LOCAL_MAX_PINS_PER_CHAT} files per chat on this device.`);
  }
  const entry = mutate(storage, chatId, (current) => {
    const pins = current.pins.filter(
      (item) => !(item.sourceId === sourceId && item.sourceType === sourceType),
    );
    pins.push({
      id: pin?.id ? String(pin.id) : `local-pin-${chatId}-${sourceType}-${sourceId}`,
      sourceType,
      sourceId,
      projectId: pin?.projectId ? String(pin.projectId) : null,
      name: pin?.name ? String(pin.name).slice(0, 200) : sourceId,
      status: "active",
      createdAt: new Date().toISOString(),
      durable: false,
    });
    return { ...current, pins: pins.slice(-LOCAL_MAX_PINS_PER_CHAT) };
  });
  return (
    entry.pins.find((item) => item.sourceId === sourceId && item.sourceType === sourceType) ?? null
  );
}

/** Returns false when nothing matched, so callers never report a fake success. */
export function unpinLocalSource(storage, chatId, pinId) {
  const before = localPins(storage, chatId);
  if (!before.some((item) => item.id === pinId)) return false;
  mutate(storage, chatId, (current) => ({
    ...current,
    pins: current.pins.filter((item) => item.id !== pinId),
  }));
  return true;
}
