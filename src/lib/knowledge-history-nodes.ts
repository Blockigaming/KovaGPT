import type { Conversation } from "./chat-store";
import type { KnowledgeNode } from "./professional.functions";

/** Keep server order/identity authoritative and append the current local history page. */
export function mergeKnowledgeHistoryNodes(
  remote: KnowledgeNode[],
  conversations: Conversation[],
  localPage: number,
): KnowledgeNode[] {
  const local: KnowledgeNode[] = conversations
    .slice(localPage * 20, (localPage + 1) * 20)
    .map((chat) => ({
      id: `local-chat:${chat.id}`,
      kind: "chat",
      label: chat.title,
      href: `/?chat=${chat.id}`,
      updatedAt: new Date(chat.updatedAt).toISOString(),
    }));
  const seen = new Set<string>();
  return [...remote, ...local].filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}
