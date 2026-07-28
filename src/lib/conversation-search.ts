import type { Conversation } from "./chat-store";

export type ConversationSearchResult = {
  conversation: Conversation;
  snippet: string;
  score: number;
};

export function searchConversations(
  conversations: Conversation[],
  input: string,
): ConversationSearchResult[] {
  const tokens = input.trim().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  let pinned: boolean | null = null;
  let attachment: boolean | null = null;
  let after = 0;
  let before = Number.POSITIVE_INFINITY;
  const terms: { value: string; titleOnly: boolean }[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, "");
    if (token === "is:pinned") pinned = true;
    else if (token === "-is:pinned") pinned = false;
    else if (token === "has:attachment") attachment = true;
    else if (token === "-has:attachment") attachment = false;
    else if (token.startsWith("after:")) after = Date.parse(token.slice(6)) || 0;
    else if (token.startsWith("before:")) before = Date.parse(token.slice(7)) || before;
    else if (token.startsWith("in:title:"))
      terms.push({ value: token.slice(9).toLowerCase(), titleOnly: true });
    else terms.push({ value: token.toLowerCase(), titleOnly: false });
  }
  return conversations
    .flatMap((conversation) => {
      if (pinned !== null && Boolean(conversation.pinned) !== pinned) return [];
      const hasAttachment = conversation.messages.some((message) => message.attachments?.length);
      if (attachment !== null && hasAttachment !== attachment) return [];
      if (conversation.updatedAt < after || conversation.updatedAt >= before) return [];
      const title = conversation.title.toLowerCase();
      const messages = conversation.messages.map((message) => message.content).join("\n");
      const content = messages.toLowerCase();
      if (
        terms.some(
          (term) => !(term.titleOnly ? title : `${title}\n${content}`).includes(term.value),
        )
      )
        return [];
      const first = terms.find((term) => !term.titleOnly && content.includes(term.value));
      const index = first ? content.indexOf(first.value) : -1;
      const snippet =
        index >= 0
          ? messages.slice(Math.max(0, index - 40), index + 120).replace(/\s+/g, " ")
          : `${conversation.messages.length} messages`;
      return [
        {
          conversation,
          snippet,
          score:
            terms.reduce(
              (score, term) =>
                score + (title.includes(term.value) ? 4 : content.includes(term.value) ? 1 : 0),
              0,
            ) + (conversation.pinned ? 1 : 0),
        },
      ];
    })
    .sort((a, b) => b.score - a.score || b.conversation.updatedAt - a.conversation.updatedAt);
}
