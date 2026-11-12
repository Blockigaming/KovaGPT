import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ImageReferenceDialog({
  onClose,
  onReturnFocus,
  onSave,
}: {
  onClose: () => void;
  onReturnFocus: () => void;
  onSave: (title: string, idempotencyKey: string) => Promise<boolean>;
}) {
  const nameId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const attemptKeys = useRef(new Map<string, string>());
  const [name, setName] = useState("");
  const [missingName, setMissingName] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const title = name.trim();
    if (!title) {
      setMissingName(true);
      input.current?.focus();
      return;
    }
    const key = attemptKeys.current.get(title) ?? crypto.randomUUID();
    attemptKeys.current.set(title, key);
    pending.current = true;
    setSaving(true);
    setSaveError("");
    try {
      if (await onSave(title, key)) onClose();
    } catch {
      setSaveError("The reference could not be saved. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending.current && onClose()}>
      <DialogContent
        className="max-sm:!bottom-0 max-sm:!left-0 max-sm:!top-auto max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!pb-[calc(20px+env(safe-area-inset-bottom))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Save reference image</DialogTitle>
          <DialogDescription>
            Name this image to find it in Library when image editing is available.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" aria-busy={saving}>
          <div className="space-y-2">
            <label htmlFor={nameId} className="text-sm font-medium">
              Reference name
            </label>
            <Input
              ref={input}
              id={nameId}
              value={name}
              maxLength={100}
              disabled={saving}
              aria-invalid={missingName || undefined}
              aria-describedby={missingName ? errorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setMissingName(false);
                setSaveError("");
              }}
            />
            {missingName && (
              <p id={errorId} className="text-sm text-destructive" role="alert">
                Enter a reference name.
              </p>
            )}
            {saveError && (
              <p className="text-sm text-destructive" role="alert">
                {saveError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save reference"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
