export type Role = "user" | "assistant";
export type Message = { id: string; role: Role; content: string };
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

const KEY = "nova-gpt-conversations-v1";

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

export function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function deriveTitle(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New chat";
}
