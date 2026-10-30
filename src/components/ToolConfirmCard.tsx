import { Button } from "@/components/ui/button";
import { useEffect, useId, useRef, useState } from "react";
import { Check, X, Loader2, Mail, Calendar, FileEdit, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import type { PendingConfirm } from "@/lib/chat-store";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";

const TOOL_LABEL: Record<string, { label: string; Icon: typeof Mail }> = {
  gmail_send: { label: "Send email", Icon: Mail },
  gmail_create_draft: { label: "Save draft", Icon: FileEdit },
  calendar_create_event: { label: "Create event", Icon: Calendar },
  calendar_delete_event: { label: "Delete event", Icon: Calendar },
};

export function ToolConfirmCard({
  confirm,
  onUpdate,
}: {
  confirm: PendingConfirm;
  onUpdate: (next: PendingConfirm) => void;
}) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const feedbackId = useId();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const currentConfirm = useRef(confirm);
  const stopFocusTracking = useRef<(() => void) | null>(null);
  currentConfirm.current = confirm;
  useEffect(() => {
    mounted.current = true;
    busyRef.current = false;
    setBusy(null);
    return () => {
      mounted.current = false;
      request.current += 1;
      stopFocusTracking.current?.();
    };
  }, [confirm.actionId]);
  const meta = TOOL_LABEL[confirm.tool] ?? { label: confirm.tool, Icon: AlertCircle };
  const Icon = meta.Icon;
  const preview = confirm.argsPreview as Record<string, unknown>;
  const reconnectRetry = confirm.status === "failed" && /reconnect/i.test(confirm.resultText ?? "");
  const isTerminal = confirm.status !== "pending" && !reconnectRetry;

  // Recoverable failures still need persistent feedback beside their Retry/Cancel controls.
  const hasFeedback = confirm.status !== "pending" || !!confirm.resultText;
  const needsAttention = !["confirmed", "cancelled"].includes(confirm.status);

  const updateConfirm = (next: PendingConfirm) => {
    currentConfirm.current = next;
    onUpdate(next);
  };

  const reconcileAmbiguousSend = async (isCurrent: () => boolean) => {
    try {
      const statusResponse = await authFetch(
        `/api/chat/confirm?action_id=${encodeURIComponent(confirm.actionId)}`,
      );
      const statusJson = (await statusResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: "pending" | "processing" | "confirmed" | "cancelled" | "failed" | "expired";
        result_text?: string;
      };
      if (!isCurrent()) return;
      if (statusResponse.ok && statusJson.ok) {
        if (statusJson.status === "confirmed") {
          updateConfirm({
            ...confirm,
            status: "confirmed",
            resultText: statusJson.result_text || "Email sent.",
          });
          toast.success("Email sent");
          return;
        }
        if (statusJson.status === "pending") {
          updateConfirm({
            ...confirm,
            status: "pending",
            resultText: "The send request did not complete. Review the email before trying again.",
          });
          toast.error("The send request did not complete. Review the email before trying again.");
          return;
        }
        if (statusJson.status === "cancelled" || statusJson.status === "expired") {
          updateConfirm({
            ...confirm,
            status: statusJson.status === "cancelled" ? "cancelled" : "failed",
            resultText:
              statusJson.status === "cancelled"
                ? "Cancelled."
                : "This send request expired. Prepare the email again.",
          });
          return;
        }
      }
    } catch {
      // The status check is best-effort. Fall through to a truthful ambiguous state.
    }

    if (!isCurrent()) return;
    const message =
      "KovaGPT could not verify whether Gmail sent this email. Check Sent mail before sending again.";
    updateConfirm({ ...confirm, status: "uncertain", resultText: message });
    toast.warning("Send result could not be verified", { description: message });
  };

  const decide = async (decision: "confirm" | "cancel", trigger: HTMLButtonElement) => {
    if (!mounted.current || busyRef.current || isTerminal || currentConfirm.current !== confirm)
      return;
    busyRef.current = true;
    const attempt = ++request.current;
    const isCurrent = () =>
      mounted.current &&
      request.current === attempt &&
      currentConfirm.current.actionId === confirm.actionId;
    const openedUrl = window.location.href;
    let focusMoved = document.activeElement !== trigger;
    const onFocus = (event: FocusEvent) => {
      if (event.target !== trigger && event.target !== document.body) focusMoved = true;
    };
    stopFocusTracking.current?.();
    document.addEventListener("focusin", onFocus, true);
    const stopTracking = () => document.removeEventListener("focusin", onFocus, true);
    stopFocusTracking.current = stopTracking;
    setBusy(decision);
    try {
      const res = await authFetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: confirm.actionId, decision }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result_text?: string;
        error?: string;
        error_code?: string;
      };
      if (!isCurrent()) return;
      if (!res.ok || !json.ok) {
        const err = json.error || `Failed (${res.status})`;
        if (
          decision === "confirm" &&
          confirm.tool === "gmail_send" &&
          (json.error_code === "completion_persistence_ambiguous" ||
            /could not (?:confirm|verify).*completed/i.test(err))
        ) {
          await reconcileAmbiguousSend(isCurrent);
          return;
        }
        updateConfirm({ ...confirm, status: "failed", resultText: err });
        toast.error(err);
        return;
      }
      updateConfirm({
        ...confirm,
        status: decision === "confirm" ? "confirmed" : "cancelled",
        resultText: json.result_text,
      });
      toast.success(decision === "confirm" ? "Done" : "Cancelled");
    } catch (e) {
      if (!isCurrent()) return;
      if (decision === "confirm" && confirm.tool === "gmail_send") {
        await reconcileAmbiguousSend(isCurrent);
      } else {
        const err = e instanceof Error ? e.message : "Network error";
        updateConfirm({ ...confirm, status: "failed", resultText: err });
        toast.error(err);
      }
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(null);
        requestAnimationFrame(() => {
          const focused = document.activeElement;
          restoreDialogFocus(
            feedbackRef.current,
            openedUrl,
            !isCurrent() || focusMoved || (focused !== trigger && focused !== document.body),
          );
          stopTracking();
        });
      } else stopTracking();
    }
  };

  return (
    <div
      aria-busy={!!busy}
      className="my-3 rounded-2xl border border-border bg-accent/30 p-4 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 text-primary" />
        <span>{meta.label}</span>
      </div>
      {typeof preview.google_account === "string" && preview.google_account.length <= 320 ? (
        <p className="mt-2 break-all text-xs text-muted-foreground">
          Google account: {preview.google_account}
        </p>
      ) : null}
      <div className="mt-1 text-foreground">{confirm.summary}</div>
      {Boolean(
        preview.to || preview.subject || preview.body_preview || preview.start || preview.location,
      ) && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {typeof preview.to === "string" && (
            <div>
              <span className="font-medium text-foreground">To:</span> {preview.to}
            </div>
          )}
          {typeof preview.cc === "string" && preview.cc && (
            <div>
              <span className="font-medium text-foreground">Cc:</span> {preview.cc}
            </div>
          )}
          {typeof preview.bcc === "string" && preview.bcc && (
            <div>
              <span className="font-medium text-foreground">Bcc:</span> {preview.bcc}
            </div>
          )}
          {typeof preview.subject === "string" && (
            <div>
              <span className="font-medium text-foreground">Subject:</span> {preview.subject}
            </div>
          )}
          {typeof preview.body_preview === "string" && (
            <div className="whitespace-pre-wrap rounded-md bg-background/60 p-2 max-h-32 overflow-y-auto">
              <span className="font-medium text-foreground">Body: </span>
              {preview.body_preview}
            </div>
          )}
          {typeof preview.start === "string" && (
            <div>
              <span className="font-medium text-foreground">Start:</span> {preview.start}
            </div>
          )}
          {typeof preview.end === "string" && preview.end.length > 0 && (
            <div>
              <span className="font-medium text-foreground">End:</span> {preview.end}
            </div>
          )}
          {typeof preview.location === "string" && preview.location.length > 0 && (
            <div>
              <span className="font-medium text-foreground">Where:</span> {preview.location}
            </div>
          )}
          {Array.isArray(preview.attendees) && (preview.attendees as string[]).length > 0 && (
            <div>
              <span className="font-medium text-foreground">Attendees:</span>{" "}
              {(preview.attendees as string[]).join(", ")}
            </div>
          )}
        </div>
      )}
      {hasFeedback && (
        <div
          ref={feedbackRef}
          id={feedbackId}
          role={needsAttention ? "alert" : "status"}
          aria-atomic="true"
          tabIndex={-1}
          className={`mt-3 max-w-full items-start gap-1.5 px-2.5 text-xs ${
            needsAttention ? "flex rounded-lg py-2" : "inline-flex rounded-full py-1"
          } ${
            confirm.status === "confirmed"
              ? "bg-primary/10 text-primary"
              : confirm.status === "cancelled"
                ? "bg-muted text-muted-foreground"
                : confirm.status === "uncertain"
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "bg-destructive/10 text-foreground"
          }`}
        >
          {confirm.status === "confirmed" ? (
            <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          ) : confirm.status === "cancelled" ? (
            <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 break-words">
            {confirm.resultText ??
              (confirm.status === "confirmed"
                ? "Done"
                : confirm.status === "cancelled"
                  ? "Cancelled"
                  : "Failed")}
          </span>
        </div>
      )}
      {!isTerminal && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="default"
            onClick={(event) => void decide("confirm", event.currentTarget)}
            aria-describedby={hasFeedback ? feedbackId : undefined}
            disabled={!!busy}
          >
            {busy === "confirm" ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {reconnectRetry
              ? "Retry"
              : confirm.tool === "calendar_delete_event"
                ? "Delete"
                : confirm.tool === "gmail_send"
                  ? "Send"
                  : "Confirm"}
          </Button>
          <Button
            variant="outline"
            onClick={(event) => void decide("cancel", event.currentTarget)}
            aria-describedby={hasFeedback ? feedbackId : undefined}
            disabled={!!busy}
          >
            {busy === "cancel" ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <X aria-hidden="true" />
            )}
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
