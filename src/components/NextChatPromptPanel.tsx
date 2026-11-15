import type { MouseEventHandler } from "react";
import { Button } from "@/components/ui/button";
import type { NextPrompt } from "@/lib/chat-send-next";

export default function NextChatPromptPanel({
  visibleNextPrompt,
  nextPromptInCurrentChat,
  canEditNextPrompt,
  onCancel,
  onEdit,
  onOpenOriginal,
}: {
  visibleNextPrompt: NextPrompt;
  nextPromptInCurrentChat: boolean;
  canEditNextPrompt: boolean;
  onCancel: MouseEventHandler<HTMLButtonElement>;
  onEdit: () => void;
  onOpenOriginal: () => void;
}) {
  return (
    <section
      aria-label="Next message"
      className="mx-3 mb-3 space-y-2 rounded-lg border p-3 text-sm"
      data-testid="next-prompt-panel"
    >
      <p role="status" className="font-medium">
        {visibleNextPrompt.status === "held"
          ? "Next message kept, not queued"
          : "Next message queued"}
      </p>
      <p className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {visibleNextPrompt.text || "Attached material"}
      </p>
      {visibleNextPrompt.attachments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {visibleNextPrompt.attachments.map((file) => file.name).join(", ")}
        </p>
      )}
      {visibleNextPrompt.tool && (
        <p className="text-xs text-muted-foreground">Tool: {visibleNextPrompt.tool}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {visibleNextPrompt.reason ??
          "Only this version will be sent after the current response finishes. Later edits stay in your draft. Kept in this tab only."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-next-prompt-cancel
          onClick={onCancel}
        >
          Cancel next message
        </Button>
        {nextPromptInCurrentChat ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!canEditNextPrompt}
            onClick={onEdit}
          >
            Edit next message
          </Button>
        ) : (
          <Button variant="outline" size="sm" type="button" onClick={onOpenOriginal}>
            Open original chat
          </Button>
        )}
      </div>
      {nextPromptInCurrentChat && !canEditNextPrompt && (
        <p className="text-xs text-muted-foreground">
          Keep or clear your newer draft before editing this saved version.
        </p>
      )}
    </section>
  );
}
