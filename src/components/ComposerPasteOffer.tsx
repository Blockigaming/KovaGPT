import { Button } from "@/components/ui/button";

export default function ComposerPasteOffer({
  text,
  attached,
  onAttach,
  onPaste,
  onCancel,
}: {
  text: string;
  attached: boolean;
  onAttach: () => void;
  onPaste: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Pasted text options"
      className="mb-2 rounded-xl border border-border bg-background p-3 text-sm"
    >
      <p>
        {attached
          ? "Pasted text is attached to this message."
          : `${text.length.toLocaleString()} characters ready to paste. Formatting is represented as plain Markdown text.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        {!attached && text.length > 10_000 && (
          <Button type="button" variant="link" size="sm" onClick={onAttach}>
            Attach full text
          </Button>
        )}
        <Button type="button" variant="link" size="sm" onClick={onPaste}>
          {attached ? "Revert to message text" : "Paste into message"}
        </Button>
        <Button type="button" variant="link" size="sm" onClick={onCancel}>
          {attached ? "Dismiss" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
