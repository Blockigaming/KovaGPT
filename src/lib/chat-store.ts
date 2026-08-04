import type { ModeId } from "./modes";

export type Role = "user" | "assistant";
export type Attachment =
  | { kind: "image"; dataUrl: string }
  | {
      kind: "text_file";
      name: string;
      content: string;
      fileType?: string | null;
      size?: number | null;
    }
  | {
      kind: "library_file";
      libraryItemId: string;
      name: string;
      fileType?: string | null;
      size?: number | null;
      sourceProject?: string | null;
    };
export type Activity = { tool: string; label: string; status: "done" | "running" };
export type PendingConfirm = {
  actionId: string;
  tool: string;
  summary: string;
  argsPreview: Record<string, unknown>;
  status: "pending" | "confirmed" | "cancelled" | "failed";
  resultText?: string;
};
export type Message = {
  id: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  pendingImage?: boolean;
  activities?: Activity[];
  pendingConfirms?: PendingConfirm[];
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  mode: ModeId;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  pinnedAt?: number;
  temporary?: boolean;
  branchOrigin?: {
    conversationId: string;
    messageId: string;
    title: string;
  };
};

export type ChatStorageUserKey = string | null;

const CONVERSATIONS_KEY_BASE = "nova-gpt-conversations-v3";
const ARCHIVED_KEY_BASE = "kovagpt:archived:v2";
const DRAFT_KEY_BASE = "kova-draft-v2";
const PENDING_ACTIVE_KEY_BASE = "nova-gpt-pending-active:v2";

const LEGACY_CONVERSATIONS_KEY = "nova-gpt-conversations-v2";
const LEGACY_ARCHIVED_KEY = "kovagpt:archived";
const LEGACY_DRAFT_KEY_BASE = "kova-draft";
const LEGACY_PENDING_ACTIVE_KEY = "nova-gpt-pending-active";

/** A stable browser-storage namespace. Signed-in and guest data never share one key. */
export function chatStoragePrincipal(userKey: ChatStorageUserKey): string {
  return userKey ? `user:${encodeURIComponent(userKey)}` : "guest";
}

function scopedKey(base: string, userKey: ChatStorageUserKey): string {
  return `${base}:${chatStoragePrincipal(userKey)}`;
}

/**
 * Guest data is session-only: it survives navigation inside the open tab, but a
 * refresh or a fresh tab starts clean. Signed-in data is untouched.
 */
function purgeGuestStorageOnFreshLoad() {
  if (typeof window === "undefined") return;
  try {
    const guestSuffix = ":guest";
    const doomed: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key.includes(guestSuffix)) doomed.push(key);
    }
    for (const key of [
      ...doomed,
      LEGACY_CONVERSATIONS_KEY,
      LEGACY_ARCHIVED_KEY,
      LEGACY_PENDING_ACTIVE_KEY,
    ])
      localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to purge.
  }
}

purgeGuestStorageOnFreshLoad();


function readWithGuestLegacyMigration(
  userKey: ChatStorageUserKey,
  key: string,
  legacyKey: string,
): string | null {
  const current = localStorage.getItem(key);
  if (current !== null || userKey !== null) return current;

  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  try {
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // The legacy guest value remains readable for this load if storage is full.
  }
  return legacy;
}

export function conversationStorageKey(userKey: ChatStorageUserKey): string {
  return scopedKey(CONVERSATIONS_KEY_BASE, userKey);
}

export function archivedConversationStorageKey(userKey: ChatStorageUserKey): string {
  return scopedKey(ARCHIVED_KEY_BASE, userKey);
}

export function draftStorageKey(
  userKey: ChatStorageUserKey,
  conversationId: string | null,
): string {
  return `${scopedKey(DRAFT_KEY_BASE, userKey)}:${conversationId ?? "__new__"}`;
}

export function pendingActiveStorageKey(userKey: ChatStorageUserKey): string {
  return scopedKey(PENDING_ACTIVE_KEY_BASE, userKey);
}

export function loadConversations(userKey: ChatStorageUserKey): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readWithGuestLegacyMigration(
      userKey,
      conversationStorageKey(userKey),
      LEGACY_CONVERSATIONS_KEY,
    );
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(userKey: ChatStorageUserKey, convs: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(conversationStorageKey(userKey), JSON.stringify(convs));
  if (userKey === null) localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
}

export function clearConversations(userKey: ChatStorageUserKey) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(conversationStorageKey(userKey));
  if (userKey === null) localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
}

export function loadArchivedConversations(userKey: ChatStorageUserKey): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readWithGuestLegacyMigration(
      userKey,
      archivedConversationStorageKey(userKey),
      LEGACY_ARCHIVED_KEY,
    );
    return JSON.parse(raw ?? "[]") as Conversation[];
  } catch {
    return [];
  }
}

export function archiveConversation(userKey: ChatStorageUserKey, conversation: Conversation) {
  const next = [
    conversation,
    ...loadArchivedConversations(userKey).filter((item) => item.id !== conversation.id),
  ].slice(0, 200);
  saveArchivedConversations(userKey, next);
}

export function saveArchivedConversations(
  userKey: ChatStorageUserKey,
  conversations: Conversation[],
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    archivedConversationStorageKey(userKey),
    JSON.stringify(conversations.slice(0, 500)),
  );
  if (userKey === null) localStorage.removeItem(LEGACY_ARCHIVED_KEY);
}

export function removeArchivedConversation(userKey: ChatStorageUserKey, id: string) {
  saveArchivedConversations(
    userKey,
    loadArchivedConversations(userKey).filter((item) => item.id !== id),
  );
}

export function loadDraft(userKey: ChatStorageUserKey, conversationId: string | null): string {
  if (typeof window === "undefined") return "";
  const legacyKey = `${LEGACY_DRAFT_KEY_BASE}:${conversationId ?? "__new__"}`;
  return (
    readWithGuestLegacyMigration(userKey, draftStorageKey(userKey, conversationId), legacyKey) ?? ""
  );
}

export function saveDraft(
  userKey: ChatStorageUserKey,
  conversationId: string | null,
  value: string,
) {
  if (typeof window === "undefined") return;
  const key = draftStorageKey(userKey, conversationId);
  const legacyKey = `${LEGACY_DRAFT_KEY_BASE}:${conversationId ?? "__new__"}`;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
  if (userKey === null) localStorage.removeItem(legacyKey);
}

export function clearDraft(userKey: ChatStorageUserKey, conversationId: string | null) {
  saveDraft(userKey, conversationId, "");
}

export function loadPendingActive(userKey: ChatStorageUserKey): string | null {
  if (typeof window === "undefined") return null;
  return readWithGuestLegacyMigration(
    userKey,
    pendingActiveStorageKey(userKey),
    LEGACY_PENDING_ACTIVE_KEY,
  );
}

export function savePendingActive(userKey: ChatStorageUserKey, conversationId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(pendingActiveStorageKey(userKey), conversationId);
  if (userKey === null) localStorage.removeItem(LEGACY_PENDING_ACTIVE_KEY);
}

export function clearPendingActive(userKey: ChatStorageUserKey) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(pendingActiveStorageKey(userKey));
  if (userKey === null) localStorage.removeItem(LEGACY_PENDING_ACTIVE_KEY);
}

/** Clear all chat-related browser data owned by exactly one principal. */
export function clearPrincipalChatStorage(userKey: ChatStorageUserKey) {
  if (typeof window === "undefined") return;
  const removeKey = (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Continue clearing the remaining current-principal keys.
    }
  };

  removeKey(conversationStorageKey(userKey));
  removeKey(archivedConversationStorageKey(userKey));
  removeKey(pendingActiveStorageKey(userKey));

  const draftPrefix = `${scopedKey(DRAFT_KEY_BASE, userKey)}:`;
  const removable: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(draftPrefix)) removable.push(key);
      if (userKey === null && key?.startsWith(`${LEGACY_DRAFT_KEY_BASE}:`)) removable.push(key);
    }
  } catch {
    // Browser storage enumeration can be disabled independently of rendering.
  }
  for (const key of removable) removeKey(key);

  if (userKey === null) {
    removeKey(LEGACY_CONVERSATIONS_KEY);
    removeKey(LEGACY_ARCHIVED_KEY);
    removeKey(LEGACY_PENDING_ACTIVE_KEY);
  }
}

export function newId() {
  return crypto.randomUUID();
}

export function deriveTitle(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New chat";
}

/** Create a persisted, independent branch without mutating its source conversation. */
export function branchConversation(source: Conversation, throughMessageId: string): Conversation {
  const index = source.messages.findIndex((message) => message.id === throughMessageId);
  if (index < 0) throw new Error("The selected message is no longer available");
  const timestamp = Date.now();
  return {
    ...source,
    id: newId(),
    title: `${source.title.replace(/ \(branch\)$/, "")} (branch)`,
    messages: source.messages.slice(0, index + 1).map((message) => ({
      ...message,
      id: newId(),
      attachments: message.attachments?.map((attachment) => ({ ...attachment })),
      activities: message.activities?.map((activity) => ({ ...activity })),
      pendingConfirms: message.pendingConfirms?.map((confirmation) => ({ ...confirmation })),
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    pinnedAt: undefined,
    branchOrigin: {
      conversationId: source.id,
      messageId: throughMessageId,
      title: source.title,
    },
  };
}
