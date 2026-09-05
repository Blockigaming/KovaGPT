import { normalizeMemorySources, type MemorySources } from "./memory-sources.mjs";
import type { ModeId } from "./modes";

export type Role = "user" | "assistant";
export type TemporaryChatContext = "clean" | "personalized";
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
  status: "pending" | "confirmed" | "cancelled" | "failed" | "uncertain";
  resultText?: string;
};
export type Message = {
  id: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  pendingImage?: boolean;
  /** Identifiers of context provided for this response; never memory bodies. */
  memorySources?: MemorySources;
  activities?: Activity[];
  pendingConfirms?: PendingConfirm[];
};
/** Only content is replayed; attribution IDs and other response metadata stay private. */
export function chatRequestMessages(previous: Message[], latest: Message) {
  return [
    ...previous.map(({ role, content }) => ({ role, content })),
    { role: latest.role, content: latest.content, attachments: latest.attachments },
  ];
}

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
  /** Immutable context policy selected when a temporary conversation starts. */
  temporaryContext?: TemporaryChatContext;
  /** Earliest message eligible for memory after a temporary chat is converted. */
  memoryStartIndex?: number;
  /**
   * Stable root chat id shared by a conversation and every branch taken from it.
   * Durable branch rows are keyed by this, so switching branches can resolve a
   * real conversation instead of only toggling metadata.
   */
  branchRootId?: string;
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
const MAX_STORED_CONVERSATIONS = 500;
const MAX_MESSAGES_PER_CONVERSATION = 1_000;

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Conversation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    typeof candidate.mode === "string" &&
    (candidate.memoryStartIndex === undefined ||
      (Number.isInteger(candidate.memoryStartIndex) && candidate.memoryStartIndex >= 0)) &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(
      (message) =>
        message &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
  );
}

function boundConversations(value: unknown[], userKey: ChatStorageUserKey): Conversation[] {
  const seen = new Set<string>();
  return value
    .filter(isConversation)
    .filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    })
    .slice(0, MAX_STORED_CONVERSATIONS)
    .map((conversation) => {
      const messages = dedupeMessages(conversation.messages);
      const removedCount = Math.max(0, messages.length - MAX_MESSAGES_PER_CONVERSATION);
      const boundedMessages = sanitizeMessageMemorySources(
        messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
        userKey,
        conversation.temporary,
      );
      return {
        ...conversation,
        messages: boundedMessages,
        ...(typeof conversation.memoryStartIndex === "number"
          ? {
              memoryStartIndex: Math.min(
                boundedMessages.length,
                Math.max(0, conversation.memoryStartIndex - removedCount),
              ),
            }
          : {}),
      };
    });
}

function sanitizeMessageMemorySources(
  messages: Message[],
  userKey: ChatStorageUserKey,
  temporary = false,
): Message[] {
  return messages.map((message) => {
    const { memorySources: rawSources, ...rest } = message;
    const memorySources =
      message.role === "assistant"
        ? normalizeMemorySources(rawSources, userKey, temporary)
        : undefined;
    return { ...rest, ...(memorySources ? { memorySources } : {}) };
  });
}

function sanitizeArchivedConversations(
  value: unknown[],
  userKey: ChatStorageUserKey,
): Conversation[] {
  return value.filter(isConversation).map((conversation) => ({
    ...conversation,
    messages: sanitizeMessageMemorySources(conversation.messages, userKey, conversation.temporary),
  }));
}

export function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

export function getConversationStats(conversation: Conversation) {
  const words = conversation.messages.reduce(
    (total, message) => total + message.content.trim().split(/\s+/u).filter(Boolean).length,
    0,
  );
  return {
    messages: conversation.messages.length,
    words,
    estimatedTokens: Math.ceil(words * 1.33),
    estimatedReadingMinutes: Math.max(1, Math.ceil(words / 220)),
  };
}

export function exportConversationMarkdown(conversation: Conversation): string {
  const stats = getConversationStats(conversation);
  const body = conversation.messages
    .map((message) => `## ${message.role === "user" ? "You" : "KovaGPT"}\n\n${message.content}`)
    .join("\n\n");
  return `# ${conversation.title}\n\n${body}\n\n---\nEstimated reading time: ${stats.estimatedReadingMinutes} minute${stats.estimatedReadingMinutes === 1 ? "" : "s"}.\n`;
}

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
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? boundConversations(parsed, userKey) : [];
  } catch {
    return [];
  }
}

export function saveConversations(userKey: ChatStorageUserKey, convs: Conversation[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      conversationStorageKey(userKey),
      JSON.stringify(boundConversations(convs, userKey)),
    );
    if (userKey === null) localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
    return true;
  } catch {
    // Storage can be unavailable or full; callers that require durable
    // acknowledgement can report the failure instead of claiming success.
    return false;
  }
}

/** Persist an explicit temporary-to-regular conversion before updating the UI. */
export function persistTemporaryConversation(
  userKey: ChatStorageUserKey,
  active: Conversation,
  conversations: Conversation[],
): Conversation[] | null {
  if (!active.temporary || !conversations.some((conversation) => conversation.id === active.id)) {
    return null;
  }
  const converted: Conversation = {
    ...active,
    temporary: false,
    temporaryContext: undefined,
    memoryStartIndex: active.messages.length,
    updatedAt: Date.now(),
  };
  const nextConversations = conversations
    .map((conversation) => (conversation.id === active.id ? converted : conversation))
    .filter((conversation) => !conversation.temporary);
  return saveConversations(userKey, nextConversations) ? nextConversations : null;
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
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? sanitizeArchivedConversations(parsed, userKey) : [];
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
    JSON.stringify(sanitizeArchivedConversations(conversations.slice(0, 500), userKey)),
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

export function subscribeToConversationChanges(
  userKey: ChatStorageUserKey,
  listener: (conversations: Conversation[]) => void,
) {
  if (typeof window === "undefined") return () => undefined;
  const key = conversationStorageKey(userKey);
  const handle = (event: StorageEvent) => {
    if (event.key === key) listener(loadConversations(userKey));
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}

/** Create a persisted, independent branch without mutating its source conversation. */
export function branchConversation(source: Conversation, throughMessageId: string): Conversation {
  const index = source.messages.findIndex((message) => message.id === throughMessageId);
  if (index < 0) throw new Error("The selected message is no longer available");
  const timestamp = Date.now();
  return {
    ...source,
    id: newId(),
    branchRootId: source.branchRootId ?? source.id,
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
    memoryStartIndex:
      typeof source.memoryStartIndex === "number"
        ? Math.min(Math.max(0, source.memoryStartIndex), index + 1)
        : undefined,
    branchOrigin: {
      conversationId: source.id,
      messageId: throughMessageId,
      title: source.title,
    },
  };
}

// Some environments report non-canonical locales (e.g. "en-US@posix"), which the
// API rejects. Fall back to a canonical tag instead of failing the request.
export function chatRequestLocale(): string {
  const raw = typeof navigator !== "undefined" ? navigator.language : "en-US";
  try {
    return Intl.getCanonicalLocales(raw)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}
