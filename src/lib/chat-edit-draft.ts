import type { PendingAttachment } from "@/components/ChatInput";

export type ChatEditDraft = {
  principal: string;
  conversationId: string;
  messageId: string;
  draft: { text: string; attachments: PendingAttachment[] };
};

export function beginChatEdit(
  previous: ChatEditDraft | null,
  principal: string,
  conversationId: string,
  messageId: string,
  text: string,
  attachments: PendingAttachment[],
): ChatEditDraft {
  const sameDraft = previous?.principal === principal && previous.conversationId === conversationId;
  return {
    principal,
    conversationId,
    messageId,
    // Selecting a second old prompt must not replace the original unsent draft.
    draft: sameDraft
      ? previous.draft
      : { text, attachments: attachments.map((attachment) => ({ ...attachment })) },
  };
}

export function restoreChatEditDraft(
  edit: ChatEditDraft | null,
  principal: string,
  conversationId: string,
) {
  if (!edit || edit.principal !== principal || edit.conversationId !== conversationId) return null;
  return {
    text: edit.draft.text,
    attachments: edit.draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function hasPendingChatAttachments(attachments: PendingAttachment[]) {
  return attachments.some(
    (attachment) => attachment.status === "uploading" || attachment.status === "selected",
  );
}
