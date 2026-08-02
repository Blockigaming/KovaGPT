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

export const CONVERSATIONS_STORAGE_KEY = "nova-gpt-conversations-v2";
const ARCHIVED_KEY = "kovagpt:archived";
const MAX_STORED_CONVERSATIONS = 500;
const MAX_MESSAGES_PER_CONVERSATION = 1_000;

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as Partial<Conversation>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(
      (message) =>
        message &&
        typeof message === "object" &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    ) &&
    typeof conversation.createdAt === "number" &&
    typeof conversation.updatedAt === "number"
  );
}

function boundConversations(values: unknown[]): Conversation[] {
  const seen = new Set<string>();
  return values
    .filter(isConversation)
    .filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    })
    .map((conversation) => ({
      ...conversation,
      title: conversation.title.trim().slice(0, 100) || "New chat",
      messages: dedupeMessages(conversation.messages).slice(-MAX_MESSAGES_PER_CONVERSATION),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_CONVERSATIONS);
}

function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

export type ConversationStats = {
  messages: number;
  attachments: number;
  words: number;
  estimatedTokens: number;
  readingMinutes: number;
  lastActive: number;
};

export function getConversationStats(conversation: Conversation): ConversationStats {
  const words = conversation.messages.reduce((total, message) => {
    const count = message.content.trim().match(/\S+/g)?.length ?? 0;
    return total + count;
  }, 0);
  return {
    messages: conversation.messages.length,
    attachments: conversation.messages.reduce(
      (total, message) => total + (message.attachments?.length ?? 0),
      0,
    ),
    words,
    estimatedTokens: Math.ceil(words * 1.33),
    readingMinutes: Math.max(1, Math.ceil(words / 220)),
    lastActive: conversation.updatedAt,
  };
}

export function exportConversationMarkdown(conversation: Conversation): string {
  const stats = getConversationStats(conversation);
  const metadata = [
    `# ${conversation.title}`,
    "",
    `- Exported: ${new Date().toISOString()}`,
    `- Last active: ${new Date(stats.lastActive).toISOString()}`,
    `- Messages: ${stats.messages}`,
    `- Attachments: ${stats.attachments}`,
    `- Estimated reading time: ${stats.readingMinutes} min`,
    "",
    "---",
    "",
  ];
  const transcript = conversation.messages.flatMap((message) => [
    `## ${message.role === "user" ? "You" : "KovaGPT"}`,
    "",
    message.content || "_(No text content)_",
    ...(message.attachments?.length ? ["", `Attachments: ${message.attachments.length}`] : []),
    "",
  ]);
  return [...metadata, ...transcript].join("\n");
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? boundConversations(parsed) : [];
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(boundConversations(convs)));
  } catch {
    // Storage can be unavailable or full (especially when chats contain image
    // attachments). Keep the live in-memory conversation usable instead of
    // throwing from a React effect and crashing the chat surface.
  }
}

export function clearConversations() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CONVERSATIONS_STORAGE_KEY);
}

export function subscribeToConversationChanges(callback: (items: Conversation[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONVERSATIONS_STORAGE_KEY) callback(loadConversations());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function loadArchivedConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ARCHIVED_KEY) ?? "[]");
    return Array.isArray(parsed) ? boundConversations(parsed) : [];
  } catch {
    return [];
  }
}

export function archiveConversation(conversation: Conversation) {
  const next = [
    conversation,
    ...loadArchivedConversations().filter((item) => item.id !== conversation.id),
  ].slice(0, 200);
  localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
}

export function saveArchivedConversations(conversations: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ARCHIVED_KEY, JSON.stringify(conversations.slice(0, 500)));
}

export function removeArchivedConversation(id: string) {
  localStorage.setItem(
    ARCHIVED_KEY,
    JSON.stringify(loadArchivedConversations().filter((item) => item.id !== id)),
  );
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
