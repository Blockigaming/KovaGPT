import { useEffect, useRef, useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp, Bookmark, Pencil } from "lucide-react";
import { toast } from "sonner";

type Props = {
  initialText: string;
  title?: string;
  onSave?: (text: string) => void;
  collapseThreshold?: number;
};

/**
 * Editable long-form writing block. For essays, emails, prompts, reports,
 * social posts, etc. Text is directly editable; Copy copies the current
 * edited value, not the original.
 */
export function EditableResponseBlock({
  initialText,
  title = "Draft",
  onSave,
  collapseThreshold = 1400,
}: Props) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(initialText.length > collapseThreshold);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setText(initialText), [initialText]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }

  function save() {
    onSave?.(text);
    toast.success("Saved to Library");
  }

  const shown = collapsed ? text.slice(0, collapseThreshold) : text;

  return (
    <div className="my-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/70 bg-muted/40">
        <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setEditing((v) => !v);
              setTimeout(() => ref.current?.focus(), 0);
            }}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
            aria-label={editing ? "Done editing" : "Edit"}
            title={editing ? "Done" : "Edit"}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={save}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
            aria-label="Save to Library"
            title="Save to Library"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={copy}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
            aria-label="Copy"
            title="Copy"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(24, Math.max(6, text.split("\n").length + 2))}
          className="w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed font-sans outline-none focus:ring-0"
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed font-sans text-foreground">
          {shown}
        </pre>
      )}

      {text.length > collapseThreshold && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border/70 bg-muted/30 transition"
        >
          {collapsed ? (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Show full ({text.length.toLocaleString()}{" "}
              chars)
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Collapse
            </>
          )}
        </button>
      )}
    </div>
  );
}
