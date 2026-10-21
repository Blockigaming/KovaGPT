import type { Conversation } from "@/lib/chat-store";

export type ShareSnapshotPayload = {
  recipient_email: string;
  title: string;
  local_chat_reference: string;
  snapshot: { messages: { role: "user" | "assistant"; content: string }[] };
};

export type ShareRequestScope = {
  open: boolean;
  principalId: string;
  conversationId: string | null;
  canAccess: boolean;
  generation: number;
};

/** Review captures only the existing server contract, never attachments or tool metadata. */
export function prepareShareSnapshot(
  conversation: Conversation,
  email: string,
  ownEmail: string,
): { payload: ShareSnapshotPayload; error?: never } | { error: string; payload?: never } {
  const recipient = email.trim().toLowerCase();
  if (recipient.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { error: "Enter a valid email address." };
  }
  if (ownEmail && recipient === ownEmail.trim().toLowerCase()) {
    return { error: "You can't share a chat with yourself." };
  }
  const messages = conversation.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(({ role, content }) => ({ role: role as "user" | "assistant", content }));
  if (!messages.some((message) => message.content.trim())) {
    return { error: "Nothing to share in this chat yet." };
  }
  if (messages.length > 500 || messages.some((message) => message.content.length > 50_000)) {
    return { error: "This chat is too long to share. Choose a shorter conversation." };
  }
  const title = conversation.title.trim() || "Shared chat";
  if (title.length > 200 || conversation.id.length > 100) {
    return { error: "This chat's title or reference is too long to share." };
  }

  // Freeze every level so later replies, edits, and branch changes cannot mutate
  // the content that the user reviewed before the separate final Share action.
  messages.forEach(Object.freeze);
  Object.freeze(messages);
  const snapshot = Object.freeze({ messages });
  return {
    payload: Object.freeze({
      recipient_email: recipient,
      title,
      local_chat_reference: conversation.id,
      snapshot,
    }),
  };
}

export function isCurrentShareRequest(expected: ShareRequestScope, current: ShareRequestScope) {
  return Boolean(
    expected.open &&
    current.open &&
    expected.canAccess &&
    current.canAccess &&
    expected.principalId &&
    expected.conversationId &&
    expected.principalId === current.principalId &&
    expected.conversationId === current.conversationId &&
    expected.generation === current.generation,
  );
}
