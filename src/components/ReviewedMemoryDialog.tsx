import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useId, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/chat-store";
import { loadReviewedMemorySource, saveReviewedMemory } from "@/lib/reviewed-memory-client.mjs";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { toast } from "sonner";

export function ReviewedMemoryDialog({
  ownerId,
  conversation,
  onClose,
  isScopeCurrent,
  returnFocusTarget,
  returnFocusUrl,
}: {
  ownerId: string;
  conversation: Conversation;
  onClose: () => void;
  isScopeCurrent: () => boolean;
  returnFocusTarget: HTMLElement | null;
  returnFocusUrl: string;
}) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const draft = useRef({ text: "", confirmed: false });
  const lock = useRef(false);
  const closing = useRef(false);
  const attempted = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const scope = useRef({ ownerId, conversation });
  scope.current = { ownerId, conversation };
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    lock.current = false;
    closing.current = false;
    attempted.current = false;
    draft.current = { text: "", confirmed: false };
    setBusy(false);
    setDiscardOpen(false);
    setChecking(true);
    setRevision(null);
    setError("");
    setText("");
    setConfirmed(false);
    void loadReviewedMemorySource(ownerId, conversation)
      .then((source) => {
        if (!controller.signal.aborted) setRevision(source.revision);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Memory eligibility could not be checked. Nothing was saved.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [ownerId, conversation]);

  useEffect(() => {
    const status = statusRef.current;
    if (error && isScopeCurrent() && status && document.activeElement === status)
      status.scrollIntoView({ block: "nearest" });
  }, [error, isScopeCurrent]);

  const save = async () => {
    if (
      !isScopeCurrent() ||
      scope.current.ownerId !== ownerId ||
      scope.current.conversation !== conversation
    )
      return;
    const reviewed = draft.current;
    if (
      lock.current ||
      checking ||
      revision === null ||
      !reviewed.confirmed ||
      !reviewed.text.trim() ||
      reviewed.text.length > 1500
    )
      return;
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted) return;
    const origin = { ownerId, conversation };
    const isCurrent = () =>
      isScopeCurrent() &&
      !controller.signal.aborted &&
      lifetime.current === controller &&
      scope.current.ownerId === origin.ownerId &&
      scope.current.conversation === origin.conversation;
    lock.current = true;
    attempted.current = true;
    setBusy(true);
    setError("");
    statusRef.current?.focus({ preventScroll: true });
    statusRef.current?.scrollIntoView({ block: "nearest" });
    try {
      await saveReviewedMemory({
        ownerId,
        conversation,
        revision,
        text: reviewed.text,
        signal: controller.signal,
        isCurrent,
      });
      if (!isCurrent()) return;
      toast.success("Reviewed memory saved for future chats");
      closing.current = true;
      onClose();
    } catch (failure) {
      if (isCurrent())
        setError(failure instanceof Error ? failure.message : "Memory could not be saved.");
    } finally {
      if (lifetime.current === controller) {
        lock.current = false;
        if (isCurrent()) setBusy(false);
      }
    }
  };
  const finishClose = () => {
    if (!lock.current && isScopeCurrent()) {
      draft.current = { text: "", confirmed: false };
      closing.current = true;
      setDiscardOpen(false);
      onClose();
    }
  };
  const close = () => {
    if (lock.current || !isScopeCurrent()) return;
    if (draft.current.text.length) setDiscardOpen(true);
    else finishClose();
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-ui-reference="chatgpt.memory-review.dialogcontent"
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreDialogFocus(returnFocusTarget, returnFocusUrl, !closing.current);
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>Save a reviewed memory</DialogTitle>
            <DialogDescription>
              Write the exact preference or fact you want KovaGPT to use in future chats. A one-time
              instruction stays in this chat unless you explicitly save it here.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Saving creates lasting account memory and replaces any saved memory from this chat. You
            can review or delete it in Memory Center. This review does not sync the chat. On Plus,
            older memories beyond the 250-memory limit may be removed.
          </p>
          <p
            ref={statusRef}
            role={error ? "alert" : "status"}
            tabIndex={-1}
            className="flex items-center gap-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                Saving reviewed memory…
              </>
            ) : (
              error || (checking ? "Checking already-synced chat…" : "")
            )}
          </p>
          {revision !== null ? (
            <>
              <label htmlFor={fieldId} className="text-sm font-medium">
                Exact memory text
              </label>
              <Textarea
                data-ui-reference="chatgpt.memory-review.textarea"
                ref={fieldRef}
                id={fieldId}
                value={text}
                maxLength={1500}
                rows={5}
                disabled={busy}
                className="w-full  border bg-background  text-sm"
                onChange={(event) => {
                  if (!lock.current) {
                    draft.current = { text: event.target.value, confirmed: false };
                    setText(event.target.value);
                    setConfirmed(false);
                  }
                }}
                aria-describedby={`${fieldId}-count`}
              />
              <p id={`${fieldId}-count`} className="text-xs text-muted-foreground">
                {text.length}/1500 characters. No text is generated or saved while you edit.
              </p>
              <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm">
                <Checkbox
                  data-ui-reference="chatgpt.checkbox"

                  checked={confirmed}
                  disabled={busy}
                  className="mt-1"
                  onCheckedChange={(checked) => {
                    if (!lock.current) {
                      draft.current = { ...draft.current, confirmed: checked === true };
                      setConfirmed(checked === true);
                    }
                  }}
                />
                <span>
                  Use this exact text in future chats, replacing any memory saved from this chat.
                </span>
              </label>
            </>
          ) : null}
          <DialogFooter className="[&>button]:w-full sm:[&>button]:w-auto">
            <Button
              data-ui-reference="chatgpt.memory-review.control"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              data-ui-reference="chatgpt.memory-review.control"
              onClick={() => void save()}
              disabled={checking || busy || revision === null || !confirmed || !text.trim()}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save memory for future chats"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!closing.current && isScopeCurrent())
              fieldRef.current?.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this memory draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {attempted.current
                ? "Discarding this draft does not undo a save already attempted. Check Memory Center for its result, or keep editing to preserve your text."
                : "Your edited text has not been saved. Keep editing to preserve it, or discard this draft."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="[&>button]:w-full sm:[&>button]:w-auto">
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={finishClose}>Discard draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
