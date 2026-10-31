import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { shareChat } from "@/lib/shared-chats.functions";
import type { Conversation } from "@/lib/chat-store";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  isCurrentShareRequest,
  prepareShareSnapshot,
  type ShareRequestScope,
  type ShareSnapshotPayload,
} from "@/lib/share-chat-preview";

export function EmailShareChatDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversation: Conversation | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    payload: ShareSnapshotPayload;
    scope: ShareRequestScope;
  } | null>(null);
  const [receipt, setReceipt] = useState<{
    payload: ShareSnapshotPayload;
    scope: ShareRequestScope;
  } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardRequest = useRef<{
    scope: ShareRequestScope;
    target: HTMLElement | null;
    discard: boolean;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const recipientEmailId = useId();
  const recipientHelpId = useId();
  const errorId = useId();
  const previewTitleId = useId();
  const recipientInput = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const share = useServerFn(shareChat);
  const { user, isLoaded, isSignedIn } = useUser();
  const principalId = isLoaded && isSignedIn ? (user?.id ?? "") : "";
  const myEmail = (user?.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  const conversationId = conversation?.id ?? null;
  const openedFor = useRef({ open, principalId, invalidated: !principalId });
  if (openedFor.current.open !== open) {
    openedFor.current = { open, principalId, invalidated: !principalId };
  } else if (open && openedFor.current.principalId !== principalId) {
    // A new account must select its own chat. Returning to the old account in
    // the same open dialog must not revive a prior review or pending request.
    openedFor.current.invalidated = true;
  }
  const canAccess = Boolean(principalId && !openedFor.current.invalidated);
  const current = useRef<ShareRequestScope>({
    open,
    principalId,
    conversationId,
    canAccess,
    generation: 0,
  });
  if (
    current.current.open !== open ||
    current.current.principalId !== principalId ||
    current.current.conversationId !== conversationId ||
    current.current.canAccess !== canAccess
  ) {
    current.current = {
      open,
      principalId,
      conversationId,
      canAccess,
      generation: current.current.generation + 1,
    };
  }
  const inFlight = useRef<ShareRequestScope | null>(null);
  const mounted = useRef(true);

  useLayoutEffect(() => {
    setEmail("");
    setReview(null);
    setError("");
    setReceipt(null);
    setDiscardOpen(false);
    discardRequest.current = null;
    setBusy(false);
    inFlight.current = null;
  }, [open, principalId, conversationId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current = {
        ...current.current,
        generation: current.current.generation + 1,
      };
    };
  }, []);

  useEffect(() => {
    if (!open || !canAccess) return;
    if (receipt) receiptHeading.current?.focus();
    else if (review) previewHeading.current?.focus();
    else recipientInput.current?.focus();
  }, [review, receipt, open, canAccess]);

  const finishClose = () => {
    if (inFlight.current) return;
    current.current = {
      ...current.current,
      open: false,
      generation: current.current.generation + 1,
    };
    discardRequest.current = null;
    setDiscardOpen(false);
    setReview(null);
    setReceipt(null);
    setEmail("");
    setError("");
    onOpenChange(false);
  };

  const close = (next: boolean) => {
    if (inFlight.current || discardRequest.current) return;
    if (next) {
      onOpenChange(true);
      return;
    }
    if (canAccess && conversation && !receipt && (email.length > 0 || review)) {
      discardRequest.current = {
        scope: current.current,
        target: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        discard: false,
      };
      setDiscardOpen(true);
      return;
    }
    finishClose();
  };

  const preview = () => {
    if (
      !mounted.current ||
      !open ||
      !canAccess ||
      !conversation ||
      inFlight.current ||
      discardRequest.current ||
      receipt
    )
      return;
    const result = prepareShareSnapshot(conversation, email, myEmail);
    if (result.payload === undefined) {
      setError(result.error);
      return;
    }
    setError("");
    setReview({ payload: result.payload, scope: current.current });
  };

  const submit = async () => {
    if (
      !review ||
      inFlight.current ||
      discardRequest.current ||
      !isCurrentShareRequest(review.scope, current.current)
    )
      return;
    const request = review.scope;
    const isCurrent = () => mounted.current && isCurrentShareRequest(request, current.current);
    inFlight.current = request;
    setBusy(true);
    setError("");
    try {
      const result = await share({ data: review.payload });
      if (!isCurrent()) return;
      if (!result?.id) throw new Error("The server did not confirm the share.");
      toast.success("Chat shared. You can manage it in Library.");
      inFlight.current = null;
      setBusy(false);
      setEmail("");
      setReview(null);
      // A durable receipt replaces the final Share action. Invalidate captured
      // submit callbacks as well, so success cannot be submitted a second time.
      current.current = { ...current.current, generation: current.current.generation + 1 };
      setReceipt({ payload: review.payload, scope: current.current });
    } catch (e) {
      if (isCurrent()) {
        const message = e instanceof Error ? e.message : "Could not share chat.";
        setError(`${message} Your review is saved here. Check Library before trying again.`);
      }
    } finally {
      if (isCurrent()) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  };

  const renderedDiscardRequest = discardRequest.current;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        data-kova-share-review=""
        ref={contentRef}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close(false);
        }}
        onInteractOutside={(event) => {
          if (inFlight.current || discardRequest.current) event.preventDefault();
        }}
        className="sm:max-w-lg [&_[data-kova-dialog-close]]:h-11 [&_[data-kova-dialog-close]]:w-11"
        aria-busy={busy}
      >
        <DialogHeader>
          <DialogTitle>
            {receipt && canAccess
              ? "Chat shared"
              : review && canAccess
                ? "Review shared chat"
                : "Share chat"}
          </DialogTitle>
          <DialogDescription>
            {receipt && canAccess
              ? "Your read-only snapshot was confirmed by the server."
              : review && canAccess
                ? "Check the recipient and exact text below. Nothing is shared until you choose Share."
                : "Share a read-only snapshot with one KovaGPT account."}
          </DialogDescription>
        </DialogHeader>
        {!canAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Your account changed or is unavailable. Close this dialog and select a chat again after
            signing in.
          </p>
        ) : receipt && isCurrentShareRequest(receipt.scope, current.current) ? (
          <section
            role="status"
            aria-live="polite"
            className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
          >
            <h3
              ref={receiptHeading}
              tabIndex={-1}
              className="rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Snapshot shared
            </h3>
            <p className="text-sm">
              “{receipt.payload.title}” was shared with{" "}
              <span className="break-all font-medium">{receipt.payload.recipient_email}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              You can manage or revoke this snapshot in Library. Later replies and edits won’t
              update it.
            </p>
          </section>
        ) : !conversation ? (
          <p role="status" className="text-sm text-muted-foreground">
            This conversation is no longer available. Close this dialog and select another chat.
          </p>
        ) : review && isCurrentShareRequest(review.scope, current.current) ? (
          <div className="shrink-0 space-y-4">
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Recipient:</span>{" "}
                <span className="break-all font-medium">{review.payload.recipient_email}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Chat:</span>{" "}
                <span className="font-medium">{review.payload.title}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Confirm this is the intended email. The recipient needs a KovaGPT account using this
                address to open the private snapshot from Library.
              </p>
            </div>
            <section aria-labelledby={previewTitleId} className="space-y-2">
              <h3
                id={previewTitleId}
                ref={previewHeading}
                tabIndex={-1}
                className="rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Snapshot preview · {review.payload.snapshot.messages.length} messages
              </h3>
              <div
                role="region"
                aria-labelledby={previewTitleId}
                tabIndex={0}
                className="max-h-[40dvh] space-y-4 overflow-y-auto overscroll-contain rounded-xl border border-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {review.payload.snapshot.messages.map((message, index) => (
                  <div key={index} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {message.role === "user" ? "You" : "Kova"}
                    </p>
                    {message.content ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.content}
                      </p>
                    ) : (
                      <p className="text-xs italic text-muted-foreground">No text content</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only the text shown above is included. Attachments, tool data and other branches
              aren’t shared. Later replies and edits won’t update this snapshot. You can revoke
              access in Library.
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Chat:</span>{" "}
              <span className="font-medium">{conversation.title || "Shared chat"}</span>
            </p>
            <div className="space-y-1.5">
              <label
                htmlFor={recipientEmailId}
                className="text-xs font-medium text-muted-foreground"
              >
                Recipient email
              </label>
              <Input
                id={recipientEmailId}
                ref={recipientInput}
                className="min-h-11"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    preview();
                  }
                }}
                placeholder="friend@example.com"
                aria-invalid={Boolean(error)}
                aria-describedby={`${recipientHelpId}${error ? ` ${errorId}` : ""}`}
              />
            </div>
            <p id={recipientHelpId} className="text-xs leading-relaxed text-muted-foreground">
              The recipient needs a KovaGPT account using this email. You’ll review the text from
              the branch you’re viewing before sharing. Future replies won’t update their copy.
            </p>
          </div>
        )}
        {error && canAccess && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            {receipt && canAccess ? "Done" : "Cancel"}
          </Button>
          {canAccess &&
            !receipt &&
            conversation &&
            (review ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setError("");
                  }}
                >
                  Back
                </Button>
                <Button data-kova-dialog-primary="" onClick={submit} disabled={busy}>
                  {busy ? (
                    <span className="spec400-loading-label">
                      <span className="spec400-loading-spinner" aria-hidden="true" />
                      Sharing…
                    </span>
                  ) : (
                    "Share"
                  )}
                </Button>
              </>
            ) : (
              <Button data-kova-dialog-primary="" onClick={preview}>
                Review snapshot
              </Button>
            ))}
        </DialogFooter>
        <AlertDialog
          open={discardOpen && canAccess}
          onOpenChange={(next) => {
            if (discardRequest.current === renderedDiscardRequest) setDiscardOpen(next);
          }}
        >
          <AlertDialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (
                mounted.current &&
                renderedDiscardRequest &&
                discardRequest.current === renderedDiscardRequest &&
                isCurrentShareRequest(renderedDiscardRequest.scope, current.current)
              )
                keepEditingRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const request = renderedDiscardRequest;
              if (discardRequest.current !== request) return;
              discardRequest.current = null;
              if (
                !mounted.current ||
                !request ||
                !isCurrentShareRequest(request.scope, current.current) ||
                !contentRef.current?.isConnected
              )
                return;
              if (request.discard) {
                // Let the nested focus scope finish before closing the parent.
                // The caller then restores the original Share invoker.
                finishClose();
                return;
              }
              const previous = request.target;
              const target =
                previous?.isConnected &&
                contentRef.current.contains(previous) &&
                previous.getClientRects().length &&
                !previous.closest('[inert], [aria-hidden="true"]') &&
                !previous.matches(':disabled, [aria-disabled="true"]')
                  ? previous
                  : review
                    ? previewHeading.current
                    : recipientInput.current;
              target?.focus({ preventScroll: true });
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Discard sharing draft?</AlertDialogTitle>
              <AlertDialogDescription>
                Your recipient and snapshot review will be cleared. This does not revoke any earlier
                share. You can check existing shares in Library.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={keepEditingRef} type="button">
                Keep editing
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  const request = renderedDiscardRequest;
                  if (
                    !request ||
                    discardRequest.current !== request ||
                    inFlight.current ||
                    !isCurrentShareRequest(request.scope, current.current)
                  ) {
                    event.preventDefault();
                    return;
                  }
                  request.discard = true;
                }}
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
