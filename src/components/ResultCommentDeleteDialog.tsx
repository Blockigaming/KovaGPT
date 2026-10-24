import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";

export type ResultCommentDeleteTarget = {
  id: string | number;
  body: string;
  scope: string;
  trigger: HTMLElement;
  url: string;
};

/** The caller keeps this mounted even after the selected row is removed. */
export function ResultCommentDeleteDialog({
  target,
  scope,
  durable,
  onClose,
  onDelete,
  fallbackRef,
}: {
  target: ResultCommentDeleteTarget | null;
  scope: string;
  durable: boolean;
  onClose: () => void;
  onDelete: (id: string | number) => Promise<void> | void;
  fallbackRef: RefObject<HTMLElement | null>;
}) {
  const [pending, setPending] = useState(false);
  const [failureState, setFailureState] = useState<{
    target: ResultCommentDeleteTarget;
    message: string;
  } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const currentScope = useRef(scope);
  const currentTarget = useRef(target);
  const active = useRef(true);
  const attempt = useRef(0);
  const busy = useRef(false);
  const returnTarget = useRef<ResultCommentDeleteTarget | null>(null);
  const confirmed = useRef(false);
  currentScope.current = scope;
  currentTarget.current = target;
  const visible = target !== null && target.scope === scope;
  const failure = visible && failureState?.target === target ? failureState.message : "";
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      attempt.current += 1;
    };
  }, []);
  useEffect(() => {
    attempt.current += 1;
    busy.current = false;
    setPending(false);
    setFailureState(null);
    confirmed.current = false;
    if (target?.scope === scope) returnTarget.current = target;
  }, [target, scope]);
  const close = () => {
    if (
      !active.current ||
      (target && (currentTarget.current !== target || currentScope.current !== target.scope))
    )
      return;
    attempt.current += 1;
    busy.current = false;
    onClose();
  };
  const remove = async () => {
    if (
      !active.current ||
      !target ||
      !visible ||
      busy.current ||
      currentTarget.current !== target ||
      currentScope.current !== target.scope
    )
      return;
    const selected = target;
    const revision = ++attempt.current;
    const isCurrent = () =>
      active.current &&
      currentScope.current === selected.scope &&
      currentTarget.current === selected &&
      attempt.current === revision;
    busy.current = true;
    // Keep focus on a retained action before the destructive button disables.
    cancelRef.current?.focus({ preventScroll: true });
    setPending(true);
    setFailureState(null);
    try {
      await onDelete(selected.id);
      if (!isCurrent()) return;
      confirmed.current = true;
      onClose();
    } catch (error) {
      if (!isCurrent()) return;
      const detail = error instanceof Error ? error.message : "The request could not be completed.";
      setFailureState({
        target: selected,
        message: durable
          ? `Deletion could not be confirmed. ${detail} The request may already have succeeded. Retrying targets only this same comment; your result text is preserved.`
          : `The comment could not be removed. ${detail}`,
      });
      // Focus only within this still-active confirmation. A later interaction owns focus.
      const focused = document.activeElement;
      if (focused === document.body || contentRef.current?.contains(focused)) {
        requestAnimationFrame(() => {
          if (
            isCurrent() &&
            (document.activeElement === document.body ||
              contentRef.current?.contains(document.activeElement))
          )
            errorRef.current?.focus();
        });
      }
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  return (
    <AlertDialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const origin = returnTarget.current;
          const focused = document.activeElement;
          const focusMoved =
            focused !== null &&
            focused !== document.body &&
            focused !== origin?.trigger &&
            !contentRef.current?.contains(focused);
          const triggerAvailable =
            origin?.trigger.isConnected && origin.trigger.getClientRects().length > 0;
          restoreDialogFocus(
            !confirmed.current && triggerAvailable ? origin?.trigger : fallbackRef.current,
            origin?.url,
            !active.current || origin?.scope !== currentScope.current || focusMoved,
          );
          returnTarget.current = null;
        }}
      >
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>
            Delete comment “{target?.body.replace(/\s+/g, " ").slice(0, 80)}
            {(target?.body.length ?? 0) > 80 ? "…" : ""}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {durable
              ? "Remove this comment from the saved result. The result text and other comments stay unchanged."
              : "Remove this comment from this editing session. The result text and other comments stay unchanged."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p
          className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-sm"
          aria-label="Comment selected for deletion"
        >
          {target?.body}
        </p>
        {pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Closing this dialog does not undo a deletion already requested.
          </p>
        ) : null}
        {failure ? (
          <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? "Deleting comment…" : "Delete comment"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
