import { useRef, useState } from "react";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { kovaAuthGeneration } from "@/lib/kova-auth-browser";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";

/** Continue through existing auth; no grant, provider action, or draft mutation. */
export function ComposerSignInDialog({
  description,
  onClose,
  returnFocusTarget,
  hasPendingMessage = false,
}: {
  description: string;
  onClose: () => void;
  returnFocusTarget: HTMLElement | null;
  hasPendingMessage?: boolean;
}) {
  const auth = useClerkSafe();
  const { user, isLoaded } = useUser();
  const currentGuest = useRef(isLoaded && !user);
  currentGuest.current = isLoaded && !user;
  const started = useRef(false);
  const openingUrl = useRef(typeof window === "undefined" ? undefined : window.location.href);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mustFinishMessage = hasPendingMessage;
  const continueToAuth = (mode: "sign-in" | "sign-up") => {
    if (started.current || mustFinishMessage || !currentGuest.current) return;
    const generation = kovaAuthGeneration();
    started.current = true;
    setBusy(true);
    setError("");
    const resetOpening = () => {
      started.current = false;
      setBusy(false);
    };
    const showOpeningFailure = () => {
      resetOpening();
      setError("Could not open sign in. Your draft is unchanged. Try again.");
    };
    try {
      // Stay on the current route; the existing Auth adapter owns continuation.
      const valid = () =>
        currentGuest.current &&
        kovaAuthGeneration() === generation &&
        window.location.href === openingUrl.current;
      if (!valid()) {
        resetOpening();
        return;
      }
      window.requestAnimationFrame(() => {
        if (!valid()) {
          resetOpening();
          return;
        }
        try {
          if (mode === "sign-up") auth.openSignUp();
          else auth.openSignIn();
          // Keep this prompt mounted until the adapter accepts the handoff so
          // a synchronous opening failure can be shown and retried in place.
          onClose();
        } catch {
          showOpeningFailure();
        }
      });
    } catch {
      showOpeningFailure();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-w-sm rounded-[28px] border-border/70 p-7"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(returnFocusTarget, openingUrl.current, started.current);
        }}
      >
        <DialogHeader>
          <DialogTitle>Sign in to continue</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {mustFinishMessage ? (
          <p role="status" className="text-sm text-muted-foreground">
            Finish or clear your current message and attachments before signing in. Close this
            prompt to return to your unchanged draft.
          </p>
        ) : null}
        <div className="mt-2 flex flex-col gap-2">
          <Button
            className="min-h-11 rounded-full"
            disabled={busy || mustFinishMessage}
            onClick={() => void continueToAuth("sign-in")}
          >
            Sign in
          </Button>
          <Button
            className="min-h-11 rounded-full"
            variant="outline"
            disabled={busy || mustFinishMessage}
            onClick={() => void continueToAuth("sign-up")}
          >
            Create account
          </Button>
          <Button className="min-h-11" variant="ghost" disabled={busy} onClick={onClose}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
