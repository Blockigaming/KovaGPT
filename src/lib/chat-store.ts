import type { ModeId } from "./modes";

export type Role = "user" | "assistant";
export type Attachment = { kind: "image"; dataUrl: string };
export type Message = {
  id: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  pendingImage?: boolean;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  mode: ModeId;
  createdAt: number;
  updatedAt: number;
};

const KEY = "nova-gpt-conversations-v2";

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

export function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function deriveTitle(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New chat";
}
