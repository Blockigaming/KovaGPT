import { useMemo } from "react";
import { t } from "@/lib/localization";
import { Pencil, X } from "lucide-react";
import { pastePreviewSnippet } from "@/lib/composer-local-attachments.mjs";
import "./pasted-text-card.css";

/**
 * A long paste shown as a compact card: the first lines of the text, a "Pasted" badge
 * and an edit control. Only a bounded snippet is ever mounted; the full text opens in
 * the preview dialog.
 */
export function PastedTextCard({
  text,
  summary,
  inspectLabel,
  removeLabel,
  status,
  variant = "composer",
  onOpen,
  onEdit,
  onRemove,
  disabled = false,
}: {
  text: string;
  summary?: string;
  inspectLabel: string;
  removeLabel?: string;
  status?: string;
  variant?: "composer" | "message";
  onOpen: (trigger: HTMLButtonElement) => void;
  onEdit?: (trigger: HTMLButtonElement) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const snippet = useMemo(() => pastePreviewSnippet(text), [text]);
  const lines = useMemo(() => text.split("\n").length, [text]);
  const detail = `${text.length.toLocaleString()} characters · ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`;
  return (
    <div className="kova-pasted-card" data-variant={variant} data-status={status}>
      <button
        type="button"
        className="kova-pasted-card-open"
        data-attachment-preview-trigger=""
        aria-haspopup="dialog"
        aria-label={inspectLabel}
        aria-description={[summary, detail].filter(Boolean).join(" · ")}
        title={[summary, detail].filter(Boolean).join(" · ")}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span className="kova-pasted-card-snippet" dir="auto" aria-hidden="true">
          {snippet}
        </span>
      </button>
      <span className="kova-pasted-card-badge" aria-hidden="true">
        {t("Pasted")}
      </span>
      {onEdit && (
        <button
          type="button"
          className="kova-pasted-card-edit"
          aria-label="Edit pasted text"
          title="Edit pasted text"
          disabled={disabled}
          onClick={(event) => onEdit(event.currentTarget)}
        >
          <Pencil aria-hidden="true" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          className="kova-pasted-card-remove"
          aria-label={removeLabel ?? "Remove pasted text"}
          title="Remove"
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
