import { normalizeMemorySources, type MemorySources } from "./memory-sources.mjs";
import type { ModeId } from "./modes";
import {
  chatHistoryView,
  canWriteChatHistory,
  chatHistorySnapshot,
  invalidateChatHistorySnapshot,
  CHAT_HISTORY_CHANGED_EVENT,
} from "./chat-history-bridge.ts";
import { normalizeResponseSources, type ResponseSource } from "./response-sources.ts";

export { normalizeResponseSources, type ResponseSource } from "./response-sources.ts";

export type Role = "user" | "assistant";
export type TemporaryChatContext = "clean" | "personalized";
export type ConversationWorkflowSkill = {
  installationId: string;
  versionId: string;
  name: string;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONVERSATION_WORKFLOW_SKILL_KEYS = new Set(["installationId", "versionId", "name"]);
export function isConversationWorkflowSkill(value: unknown): value is ConversationWorkflowSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== CONVERSATION_WORKFLOW_SKILL_KEYS.size ||
    keys.some((key) => !CONVERSATION_WORKFLOW_SKILL_KEYS.has(key))
  )
    return false;
  const candidate = value as Partial<ConversationWorkflowSkill>;
  return (
    typeof candidate.installationId === "string" &&
    UUID_PATTERN.test(candidate.installationId) &&
    typeof candidate.versionId === "string" &&
    UUID_PATTERN.test(candidate.versionId) &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    candidate.name.length <= 120
  );
}
export type ComposerToolId =
  "web_search" | "deep_research" | "image" | "study" | "data_analysis" | "file_analysis";
const COMPOSER_TOOL_IDS = new Set<ComposerToolId>([
  "web_search",
  "deep_research",
  "image",
  "study",
  "data_analysis",
  "file_analysis",
]);
export function isComposerToolId(value: unknown): value is ComposerToolId {
  return typeof value === "string" && COMPOSER_TOOL_IDS.has(value as ComposerToolId);
}
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
export type Activity = {
  tool: string;
  label: string;
  status: "done" | "running" | "failed" | "canceled";
};
export type ResearchProgress = {
  stage: string;
  label: string;
  status: "created" | "pending" | "running" | "complete" | "failed" | "canceled";
  detail?: string;
  progress: number;
  warnings?: string[];
};
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
  /** Safe, provider-normalized web sources used to produce this response. */
  sources?: ResponseSource[];
  researchProgress?: ResearchProgress;
  pendingConfirms?: PendingConfirm[];
  /** A stopped or failed response remains retryable instead of reading as a completed answer. */
  generationStatus?: "stopped" | "failed";
  /** The explicit composer operation that created this response, retained for faithful retry. */
  requestedTool?: ComposerToolId;
};

export function markAssistantStopped(messages: Message[], assistantMessageId: string): Message[] {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === "assistant",
  );
  if (assistantIndex === -1) return messages;

  return messages.map((message, index) => {
    if (index !== assistantIndex) return message;
    const { pendingImage: _pendingImage, ...terminalMessage } = message;
    const researchRunning =
      message.researchProgress &&
      !["complete", "failed", "canceled"].includes(message.researchProgress.status);
    return {
      ...terminalMessage,
      generationStatus: "stopped" as const,
      activities: message.activities?.map((activity) =>
        activity.status === "running" ? { ...activity, status: "canceled" as const } : activity,
      ),
      ...(researchRunning && message.researchProgress
        ? {
            researchProgress: {
              ...message.researchProgress,
              label: "Research canceled",
              status: "canceled" as const,
            },
          }
        : {}),
    };
  });
}
/** Only content is replayed; attribution IDs and other response metadata stay private. */
export function chatRequestMessages(previous: Message[], latest: Message) {
  return [
    ...previous.map(({ role, content }) => ({ role, content })),
    { role: latest.role, content: latest.content, attachments: latest.attachments },
  ];
}

export type Conversation = {
  /** A selected Kova never carries link capabilities or another user's credentials. */
  kova?: { id: string; versionId?: string };
  /** An owner installation and immutable version reference; package text stays server-side. */
  skill?: ConversationWorkflowSkill;
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
    (candidate.skill === undefined || isConversationWorkflowSkill(candidate.skill)) &&
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

const researchStatuses = new Set<ResearchProgress["status"]>([
  "created",
  "pending",
  "running",
  "complete",
  "failed",
  "canceled",
]);

export function normalizeResearchProgress(
  value: unknown,
  interruptNonterminal = false,
): ResearchProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ResearchProgress>;
  if (
    typeof candidate.stage !== "string" ||
    typeof candidate.label !== "string" ||
    !researchStatuses.has(candidate.status as ResearchProgress["status"]) ||
    typeof candidate.progress !== "number" ||
    !Number.isFinite(candidate.progress)
  )
    return undefined;
  const interrupted =
    interruptNonterminal &&
    candidate.status !== "complete" &&
    candidate.status !== "failed" &&
    candidate.status !== "canceled";
  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings
        .filter((warning): warning is string => typeof warning === "string")
        .map((warning) => warning.trim().slice(0, 320))
        .filter(Boolean)
        .slice(-3)
    : [];
  return {
    stage: candidate.stage.slice(0, 80),
    label: interrupted ? "Research interrupted" : candidate.label.slice(0, 160),
    status: interrupted ? "failed" : (candidate.status as ResearchProgress["status"]),
    ...(interrupted
      ? { detail: "This research stopped when the page reloaded. Retry to continue." }
      : typeof candidate.detail === "string" && candidate.detail
        ? { detail: candidate.detail.slice(0, 240) }
        : {}),
    progress: Math.min(1, Math.max(0, candidate.progress)),
    ...(warnings.length ? { warnings } : {}),
  };
}

function boundConversations(
  value: unknown[],
  userKey: ChatStorageUserKey,
  interruptResearch = false,
): Conversation[] {
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
      ).map((message) => {
        const { researchProgress: storedResearchProgress, ...messageWithoutResearchProgress } =
          message;
        const researchProgress = normalizeResearchProgress(
          storedResearchProgress,
          interruptResearch,
        );
        return {
          ...messageWithoutResearchProgress,
          ...(researchProgress ? { researchProgress } : {}),
          ...(researchProgress?.label === "Research interrupted" &&
          Array.isArray(messageWithoutResearchProgress.activities)
            ? {
                activities: messageWithoutResearchProgress.activities.map((activity) =>
                  activity.status === "running"
                    ? { ...activity, status: "failed" as const }
                    : activity,
                ),
              }
            : {}),
        };
      });
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
    const {
      memorySources: rawSources,
      sources: rawResponseSources,
      generationStatus,
      requestedTool,
      ...rest
    } = message;
    const memorySources =
      message.role === "assistant"
        ? normalizeMemorySources(rawSources, userKey, temporary)
        : undefined;
    const responseSources =
      message.role === "assistant" ? normalizeResponseSources(rawResponseSources) : undefined;
    return {
      ...rest,
      ...(memorySources ? { memorySources } : {}),
      ...(responseSources ? { sources: responseSources } : {}),
      ...(message.role === "assistant" &&
      (generationStatus === "stopped" || generationStatus === "failed")
        ? { generationStatus }
        : {}),
      ...(message.role === "assistant" && isComposerToolId(requestedTool) ? { requestedTool } : {}),
    };
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
  const synced = chatHistoryView(userKey);
  if (synced?.ready) return synced.active;
  try {
    const raw = readWithGuestLegacyMigration(
      userKey,
      conversationStorageKey(userKey),
      LEGACY_CONVERSATIONS_KEY,
    );
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? boundConversations(parsed, userKey, true) : [];
  } catch {
    return [];
  }
}

export function saveConversations(
  userKey: ChatStorageUserKey,
  convs: Conversation[],
  options?: { snapshot: number },
): boolean | Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!canWriteChatHistory(userKey)) return false;
  if (options && options.snapshot !== chatHistorySnapshot(userKey)) return false;
  if (!options) invalidateChatHistorySnapshot(userKey);
  const synced = chatHistoryView(userKey);
  if (synced) {
    if (!synced.ready || !synced.writable) return false;
    synced.markDirty();
    return synced.write(convs, false, Boolean(options));
  }
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
export async function persistTemporaryConversation(
  userKey: ChatStorageUserKey,
  active: Conversation,
  conversations: Conversation[],
): Promise<Conversation[] | null> {
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
  return (await saveConversations(userKey, nextConversations)) ? nextConversations : null;
}

export function clearConversations(userKey: ChatStorageUserKey) {
  if (chatHistoryView(userKey)) return saveConversations(userKey, []);
  if (typeof window === "undefined") return;
  localStorage.removeItem(conversationStorageKey(userKey));
  if (userKey === null) localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
}

export function loadArchivedConversations(userKey: ChatStorageUserKey): Conversation[] {
  if (typeof window === "undefined") return [];
  const synced = chatHistoryView(userKey);
  if (synced?.ready) return synced.archived;
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
  ];
  return saveArchivedConversations(userKey, next);
}

export function saveArchivedConversations(
  userKey: ChatStorageUserKey,
  conversations: Conversation[],
): boolean | Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!canWriteChatHistory(userKey)) return false;
  invalidateChatHistorySnapshot(userKey);
  const synced = chatHistoryView(userKey);
  if (synced) {
    if (!synced.ready || !synced.writable) return false;
    synced.markDirty();
    return synced.write(conversations, true);
  }
  try {
    localStorage.setItem(
      archivedConversationStorageKey(userKey),
      JSON.stringify(sanitizeArchivedConversations(conversations.slice(0, 500), userKey)),
    );
    if (userKey === null) localStorage.removeItem(LEGACY_ARCHIVED_KEY);
    return true;
  } catch {
    return false;
  }
}

export function removeArchivedConversation(userKey: ChatStorageUserKey, id: string) {
  return saveArchivedConversations(
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
  const cloud = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.ownerId === userKey && detail.source === "cloud")
      listener(loadConversations(userKey));
  };
  window.addEventListener(CHAT_HISTORY_CHANGED_EVENT, cloud);
  return () => {
    window.removeEventListener("storage", handle);
    window.removeEventListener(CHAT_HISTORY_CHANGED_EVENT, cloud);
  };
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
      sources: message.sources?.map((source) => ({ ...source })),
      researchProgress: message.researchProgress
        ? {
            ...message.researchProgress,
            warnings: message.researchProgress.warnings?.slice(),
          }
        : undefined,
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
