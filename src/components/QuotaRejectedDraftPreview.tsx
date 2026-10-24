import type { NextPrompt } from "@/lib/chat-send-next";

/** Usage-limit preview text loads only when a rejected draft has been retained. */
export function QuotaRejectedDraftPreview({ draft }: { draft: NextPrompt }) {
  return (
    <>
      <p role="status">Your message was not sent because of a usage limit. This version is kept.</p>
      <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
        {draft.text ? draft.text.slice(0, 400) : "Attached material"}
      </p>
      {draft.text.length > 400 && (
        <p className="text-xs text-muted-foreground">
          Preview shortened to 400 characters. Restore keeps the full message.
        </p>
      )}
      {draft.attachments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {draft.attachments
            .slice(0, 3)
            .map((file) => (file.name.length > 80 ? `${file.name.slice(0, 80)}…` : file.name))
            .join(", ")}
          {(draft.attachments.length > 3 ||
            draft.attachments.some((file) => file.name.length > 80)) && (
            <>
              {" "}
              (Attachment preview shortened. Restore keeps all {draft.attachments.length}{" "}
              attachments.)
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Keep or clear your newer draft before restoring this version. Restoring does not send it.
        Kept only while this chat stays open. Up to three versions can be kept; restore or discard
        one before sending more.
      </p>
    </>
  );
}
