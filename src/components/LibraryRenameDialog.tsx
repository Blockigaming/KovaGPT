import { useEffect, useId, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { renameLibrarySavedItem, type LibraryItem } from "@/lib/library.functions";
import { validateLibraryTitle } from "@/lib/library-title-policy";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LibraryRenameDialog({
  item,
  owner,
  isCurrent,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  item: LibraryItem;
  owner: string;
  isCurrent: () => boolean;
  onClose: () => void;
  onSaved: (value: {
    id: string;
    title: string;
    updated_at: string;
    content_generation: string;
  }) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const rename = useServerFn(renameLibrarySavedItem);
  const id = useId();
  const [title, setTitle] = useState(item.title);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const active = useRef(true),
    pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const currentRef = useRef(isCurrent);
  currentRef.current = isCurrent;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentRef.current();
  let titleError = "";
  try {
    validateLibraryTitle(title);
  } catch (cause) {
    titleError = (cause as Error).message;
  }
  const dirty = title !== item.title;
  const requestClose = () => {
    if (!current() || pending.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    if (
      (busy || error) &&
      current() &&
      (document.activeElement === document.body || status.current?.contains(document.activeElement))
    )
      status.current?.focus({ preventScroll: true });
  }, [busy, error]);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (pending.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending.current) event.preventDefault();
          }}
        >
          <DialogTitle>Rename saved title</DialogTitle>
          <DialogDescription>
            Change this saved item's title. Its original filename, stored content, links and
            versions stay the same.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!current() || pending.current || !dirty || error) return;
              setTouched(true);
              if (titleError || !item.content_generation) {
                input.current?.focus();
                return;
              }
              const value = validateLibraryTitle(title);
              pending.current = true;
              setBusy(true);
              setError(null);
              status.current?.focus({ preventScroll: true });
              void rename({
                data: {
                  expectedOwnerId: owner,
                  id: item.id,
                  generation: item.content_generation,
                  previousTitle: item.title,
                  title: value,
                },
              })
                .then((result) => {
                  if (current()) onSaved(result);
                })
                .catch((cause: unknown) => {
                  if (current())
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "The title change could not be confirmed. Refresh Library before retrying.",
                    );
                })
                .finally(() => {
                  pending.current = false;
                  if (current()) setBusy(false);
                });
            }}
          >
            <label className="grid gap-2 text-sm" htmlFor={id}>
              Saved title
              <Input
                id={id}
                ref={input}
                value={title}
                maxLength={200}
                disabled={busy}
                autoFocus
                aria-invalid={touched && Boolean(titleError)}
                aria-describedby={touched && titleError ? `${id}-error` : undefined}
                onBlur={() => setTouched(true)}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {touched && titleError ? (
              <p id={`${id}-error`} role="alert" className="text-sm">
                {titleError}
              </p>
            ) : null}
            <div
              ref={status}
              tabIndex={-1}
              role={error ? "alert" : "status"}
              aria-live="polite"
              className="text-sm"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Saving title…
                </span>
              ) : (
                error
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !dirty || Boolean(titleError) || Boolean(error)}
              >
                {busy ? "Saving…" : "Save title"}
              </Button>
            </div>
            {error ? (
              <p className="text-sm text-muted-foreground">
                Your draft is kept. Close this dialog and refresh Library to check the current title
                before retrying.
              </p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (current()) input.current?.focus();
          }}
        >
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Discard the title change?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved title stays unchanged. Your unsaved title will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscard(false);
                onClose();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
