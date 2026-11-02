import { Copy, Check } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";

export function PromptMessage({
  content,
  copied,
  onCopy,
  onEdit,
  onBranch,
}: {
  content: string;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onBranch?: () => void;
}) {
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="kova-user-message prose-chat whitespace-pre-wrap break-words bg-[var(--surface-secondary)] px-4 py-3 text-foreground"
            tabIndex={0}
            aria-label="Sent prompt"
          >
            {content}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onCopy}>Copy prompt</ContextMenuItem>
          {onEdit && <ContextMenuItem onSelect={onEdit}>Edit message</ContextMenuItem>}
          {onBranch && (
            <ContextMenuItem onSelect={onBranch}>
              Branch from this message in a new chat
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <div className="kova-prompt-actions">
        <button
          type="button"
          onClick={onCopy}
          className="kova-prompt-copy text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-copied={copied}
          aria-label={copied ? "Copied prompt" : "Copy prompt"}
          title={copied ? "Copied" : "Copy prompt"}
        >
          <Copy className="kova-copy-glyph" aria-hidden="true" />
          <Check className="kova-copy-check" aria-hidden="true" />
        </button>
        <span className="sr-only" role="status">
          {copied ? "Prompt copied" : ""}
        </span>
      </div>
    </>
  );
}
