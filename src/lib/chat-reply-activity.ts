const BACKGROUND_CHAT_REPLY = "kova:background-chat-reply";
type ChatReplyActivity = { ownerId: string; chatId: string };

export function announceBackgroundChatReply(ownerId: string, chatId: string) {
  window.dispatchEvent(
    new CustomEvent<ChatReplyActivity>(BACKGROUND_CHAT_REPLY, { detail: { ownerId, chatId } }),
  );
}

export function subscribeToChatReplies(listener: (activity: ChatReplyActivity) => void) {
  const onReply = (event: Event) => listener((event as CustomEvent<ChatReplyActivity>).detail);
  window.addEventListener(BACKGROUND_CHAT_REPLY, onReply);
  return () => window.removeEventListener(BACKGROUND_CHAT_REPLY, onReply);
}
