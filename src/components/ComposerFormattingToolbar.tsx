import { useState, type RefObject } from "react";
import { Bold, ChevronDown, Italic, Link2 } from "lucide-react";

const styles = [
  ["Text", ""],
  ["Heading 1", "# "],
  ["Heading 2", "## "],
  ["Heading 3", "### "],
  ["Numbered list", "1. "],
  ["Bulleted list", "- "],
] as const;

export type ComposerSelection = { start: number; end: number; draft: string };

export function ComposerFormattingToolbar({
  inputRef,
  selection,
  onChange,
  onClose,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  selection: ComposerSelection;
  onChange: (draft: string) => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"styles" | "link" | null>(null);
  const { start, end, draft } = selection;
  const selected = draft.slice(start, end);
  const apply = (replacement: string, from = start, to = end) => {
    if (inputRef.current?.value !== draft) return onClose();
    onChange(draft.slice(0, from) + replacement + draft.slice(to));
    onClose();
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      const caret = from + replacement.length;
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };
  const applyStyle = (prefix: (typeof styles)[number][1]) => {
    const first = start === 0 ? 0 : draft.lastIndexOf("\n", start - 1) + 1;
    const lastBreak = draft.indexOf("\n", Math.max(start, end - 1));
    const last = lastBreak < 0 ? draft.length : lastBreak;
    const lines = draft.slice(first, last).split("\n");
    apply(
      lines
        .map((line, index) => {
          const text = line.replace(/^(?:#{1,3} |[-*+] |\d+\. )/u, "");
          return text ? (prefix === "1. " ? `${index + 1}. ` : prefix) + text : text;
        })
        .join("\n"),
      first,
      last,
    );
  };
  const wrap = (marker: string) =>
    apply(selected.replace(/^(\s*)([\s\S]*?)(\s*)$/u, `$1${marker}$2${marker}$3`));

  return (
    <div
      className="kova-composer-formatting"
      role="group"
      aria-label="Format selected draft text"
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget) &&
          event.relatedTarget !== inputRef.current
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          inputRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        type="button"
        aria-label="Add link"
        aria-expanded={panel === "link"}
        onClick={() => setPanel(panel === "link" ? null : "link")}
      >
        <Link2 aria-hidden="true" />
      </button>
      <button type="button" aria-label="Bold" onClick={() => wrap("**")}>
        <Bold aria-hidden="true" />
      </button>
      <button type="button" aria-label="Italic" onClick={() => wrap("*")}>
        <Italic aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-expanded={panel === "styles"}
        onClick={() => setPanel(panel === "styles" ? null : "styles")}
      >
        Text <ChevronDown aria-hidden="true" />
      </button>
      {panel === "styles" && (
        <div className="kova-composer-formatting-panel" aria-label="Text styles">
          {styles.map(([label, prefix]) => (
            <button type="button" key={label} onClick={() => applyStyle(prefix)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {panel === "link" && (
        <form
          className="kova-composer-formatting-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem("format-url") as HTMLInputElement;
            const url = URL.canParse(field.value) ? new URL(field.value) : null;
            if (!url || !["https:", "http:"].includes(url.protocol)) {
              field.setCustomValidity("Enter an HTTP or HTTPS link.");
              field.reportValidity();
              return;
            }
            const label = selected
              .trim()
              .replace(/[\\[\]]/gu, "\\$&")
              .replace(/\s+/gu, " ");
            apply(`[${label}](<${url.href.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`);
          }}
        >
          <input
            name="format-url"
            type="url"
            aria-label="Link URL"
            placeholder="https://"
            required
            onChange={(event) => event.currentTarget.setCustomValidity("")}
          />
          <button type="submit">Apply link</button>
        </form>
      )}
    </div>
  );
}
