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

const KEY = "nova-gpt-conversations-v2";
const ARCHIVED_KEY = "kovagpt:archived";

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(convs));
}

export function clearConversations() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

export function loadArchivedConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(ARCHIVED_KEY) ?? "[]") as Conversation[];
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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
