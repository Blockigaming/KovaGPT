import type { Conversation } from "@/lib/chat-store";
import type { CloudConversationRow } from "@/lib/cloud-conversations.functions";

export type ReconciledHistory = {
  active: Conversation[];
  archived: Conversation[];
  pending: Array<{ conversation: Conversation; archived: boolean }>;
};

export function reconcileCloudHistory(
  localActive: Conversation[],
  localArchived: Conversation[],
  cloudRows: CloudConversationRow[],
): ReconciledHistory {
  const local = new Map<string, { conversation: Conversation; archived: boolean }>();
  localActive.forEach((conversation) =>
    local.set(conversation.id, { conversation, archived: false }),
  );
  localArchived.forEach((conversation) =>
    local.set(conversation.id, { conversation, archived: true }),
  );

  const cloud = new Map(cloudRows.map((row) => [row.conversation_id, row]));
  for (const row of cloudRows) {
    const device = local.get(row.conversation_id);
    if (row.deleted) {
      if (!device || row.client_updated_at >= device.conversation.updatedAt) {
        local.delete(row.conversation_id);
      }
      continue;
    }
    if (!row.payload) continue;
    if (!device || row.client_updated_at > device.conversation.updatedAt) {
      local.set(row.conversation_id, { conversation: row.payload, archived: row.archived });
    }
  }

  const values = [...local.values()].sort(
    (a, b) => b.conversation.updatedAt - a.conversation.updatedAt,
  );
  const pending = values.filter(({ conversation, archived }) => {
    const remote = cloud.get(conversation.id);
    return (
      !remote ||
      remote.deleted ||
      conversation.updatedAt > remote.client_updated_at ||
      archived !== remote.archived
    );
  });
  return {
    active: values.filter((item) => !item.archived).map((item) => item.conversation),
    archived: values.filter((item) => item.archived).map((item) => item.conversation),
    pending,
  };
}
