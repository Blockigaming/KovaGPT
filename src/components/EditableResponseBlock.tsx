import { useEffect, useRef, useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp, Loader2, Pencil, Save } from "lucide-react";
import { toast } from "sonner";

export type ResponseEditSave = {
  text: string;
  /** Character range the user had selected when they started editing, if any. */
  selectionStart: number | null;
  selectionEnd: number | null;
};

type Props = {
  initialText: string;
  title?: string;
  /**
   * Persists the edit. Must resolve only after the edit is durably stored;
   * rejecting surfaces a real error to the user. When omitted, the block is
   * read-only — it never claims to have saved anything.
   */
  onSave?: (edit: ResponseEditSave) => Promise<void> | void;
  saveLabel?: string;
  collapseThreshold?: number;
};

/**
 * Editable long-form writing block. For essays, emails, prompts, reports,
 * social posts, etc. Text is directly editable; Copy copies the current
 * edited value, not the original.
 *
 * TRUTHFULNESS: Save is only shown when a persistence handler exists, the
 * success message appears only after that handler resolves, and a failure keeps
 * the editor open with the user's text intact so nothing is silently lost.
 */
export function EditableResponseBlock({
  initialText,
  title = "Draft",
  onSave,
  saveLabel = "Save edit",
  collapseThreshold = 1400,
}: Props) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(initialText.length > collapseThreshold);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  useEffect(() => {
    setText(initialText);
    setSavedAt(null);
    setError(null);
  }, [initialText]);

  const dirty = text !== initialText;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }

  function rememberSelection() {
    const node = ref.current;
    if (!node) return;
    const { selectionStart, selectionEnd } = node;
    if (selectionStart === selectionEnd) return;
    selectionRef.current = { start: selectionStart, end: selectionEnd };
  }

  async function save() {
    if (!onSave || saving) return;
    if (!text.trim()) {
      setError("The text cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        text,
        selectionStart: selectionRef.current.start,
        selectionEnd: selectionRef.current.end,
      });
      setSavedAt(Date.now());
      setEditing(false);
      toast.success("Edit saved");
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "The edit could not be saved.";
      // Keep editing mode open so the user's work is never discarded.
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const shown = collapsed ? text.slice(0, collapseThreshold) : text;

  return (
    <div className="my-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/70 bg-muted/40">
        <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
        <div className="flex items-center gap-1">
          {onSave ? (
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
          ) : null}
          {onSave ? (
            <button
              onClick={() => void save()}
              disabled={saving || !dirty}
              aria-busy={saving}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label={saveLabel}
              title={dirty ? saveLabel : "No changes to save"}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
            </button>
          ) : null}
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
          onSelect={rememberSelection}
          rows={Math.min(24, Math.max(6, text.split("\n").length + 2))}
          className="w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed font-sans outline-none focus:ring-0"
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed font-sans text-foreground">
          {shown}
        </pre>
      )}

      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {error}
        </p>
      ) : savedAt && !dirty ? (
        <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">
          Saved to this chat's edit history.
        </p>
      ) : null}

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
