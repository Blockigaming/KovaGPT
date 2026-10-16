import type { ReactNode } from "react";

/** Per-message attachments only; no memory, privacy or connector permissions are changed. */
export function ComposerContextPanel({
  attachments,
  selectedTool,
  disabled,
  onRemove,
  library,
  chatRulesActive,
  onOpenChatContext,
}: {
  attachments: readonly { name: string; sourceProject?: string | null; status?: string }[];
  selectedTool?: string;
  disabled: boolean;
  onRemove: (index: number) => void;
  library: ReactNode;
  chatRulesActive?: boolean;
  onOpenChatContext?: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-5 text-muted-foreground">
        Review files for your next message. This does not change memory or temporary-chat settings.
      </p>
      <section aria-label="Current message context">
        <h3 className="text-sm font-semibold" aria-live="polite">
          Attached files ({attachments.length}/2)
        </h3>
        {attachments.length ? (
          <ul className="mt-2 space-y-2">
            {attachments.map((file, index) => (
              <li key={index} className="flex min-w-0 items-center gap-3 rounded-xl border p-3">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="block text-sm font-medium">{file.name}</span>
                  {file.sourceProject ? (
                    <span className="block text-sm text-muted-foreground">
                      {file.sourceProject}
                    </span>
                  ) : null}
                  {file.status && file.status !== "complete" ? (
                    <span className="block text-sm text-muted-foreground">{file.status}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${file.name} from message context`}
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No files attached to this message.</p>
        )}
        {selectedTool ? <p className="mt-3 text-sm">Selected tool: {selectedTool}</p> : null}
      </section>
      {onOpenChatContext ? (
        <section aria-label="Current chat context">
          <p className="text-sm mb-2">
            {chatRulesActive
              ? "Chat rules are active."
              : "Review rules and pinned files for this chat."}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenChatContext}
            className="min-h-11 rounded-lg border px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Chat rules and pinned files
          </button>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Chat rules and pinned files are available after you create a chat.
        </p>
      )}
      <section aria-label="Library context">
        <h3 className="mb-2 text-sm font-semibold">Add from Library</h3>
        {library}
      </section>
    </div>
  );
}
