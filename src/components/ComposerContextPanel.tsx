import type { ReactNode } from "react";

/** Only explicitly selected material is included; this is not an account-wide search. */
export function ComposerContextPanel({
  attachments,
  selectedTool,
  disabled,
  onRemove,
  onInspect,
  library,
  chatRulesActive,
  onOpenChatContext,
}: {
  attachments: readonly {
    name: string;
    kind?: string;
    sourceProject?: string | null;
    status?: string;
    error?: string;
    extractionNote?: string;
  }[];
  selectedTool?: string;
  disabled: boolean;
  onRemove: (index: number) => void;
  onInspect?: (index: number) => void;
  library: ReactNode;
  chatRulesActive?: boolean;
  onOpenChatContext?: () => void;
}) {
  return (
    <div className="spec400-context-sections">
      <section aria-labelledby="context-project-heading">
        <h3 id="context-project-heading">Project instructions</h3>
        <p>
          This chat has no project association. Open a project to use its instructions and files.
        </p>
      </section>
      <section aria-labelledby="context-files-heading">
        <h3 id="context-files-heading">
          Files <span>({attachments.length}/2)</span>
        </h3>
        {attachments.length ? (
          <ul className="spec400-context-files">
            {attachments.map((file, index) => (
              <li key={`${file.name}:${index}`}>
                <button
                  type="button"
                  className="spec400-context-inspect"
                  onClick={() => onInspect?.(index)}
                >
                  <strong>{file.name}</strong>
                  <span>
                    {file.sourceProject
                      ? `Project: ${file.sourceProject}`
                      : file.kind === "library_file"
                        ? "Library reference"
                        : "Attached to this message"}
                  </span>
                  <span>
                    {file.status === "failed"
                      ? "Failed"
                      : file.status === "uploading"
                        ? "Processing"
                        : file.kind === "library_file"
                          ? "Readability checked when sent"
                          : file.status === "complete"
                            ? "Ready"
                            : "Queued"}
                  </span>
                  {file.error && <span className="text-destructive">{file.error}</span>}
                  {file.extractionNote && <span>{file.extractionNote}</span>}
                </button>
                <button
                  type="button"
                  className="spec400-toolbar-button"
                  disabled={disabled}
                  aria-label={`Remove ${file.name} from message context`}
                  onClick={() => onRemove(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No files attached to this message.</p>
        )}
      </section>
      <section aria-labelledby="context-results-heading">
        <h3 id="context-results-heading">Saved results</h3>
        <p>Choose material from Library to include it. Files are never attached automatically.</p>
        {library}
      </section>
      <section aria-labelledby="context-conversation-heading">
        <h3 id="context-conversation-heading">Conversation context</h3>
        <p>
          {chatRulesActive
            ? "Chat rules are active."
            : "Existing messages remain part of this conversation."}
        </p>
        {selectedTool && <p>Selected tool: {selectedTool}</p>}
        {onOpenChatContext ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenChatContext}
            className="spec400-toolbar-button"
          >
            Chat rules and pinned files
          </button>
        ) : (
          <p>Chat rules and pinned files become available after you create a chat.</p>
        )}
      </section>
    </div>
  );
}
