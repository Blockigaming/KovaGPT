import { useState } from "react";
import { Check, X, Loader2, Mail, Calendar, FileEdit, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import type { PendingConfirm } from "@/lib/chat-store";

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
  const meta = TOOL_LABEL[confirm.tool] ?? { label: confirm.tool, Icon: AlertCircle };
  const Icon = meta.Icon;
  const preview = confirm.argsPreview as Record<string, unknown>;
  const isTerminal = confirm.status !== "pending";

  const decide = async (decision: "confirm" | "cancel") => {
    if (busy || isTerminal) return;
    setBusy(decision);
    try {
      const res = await authFetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: confirm.actionId, decision }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result_text?: string; error?: string };
      if (!res.ok || !json.ok) {
        const err = json.error || `Failed (${res.status})`;
        onUpdate({ ...confirm, status: "failed", resultText: err });
        toast.error(err);
        return;
      }
      onUpdate({
        ...confirm,
        status: decision === "confirm" ? "confirmed" : "cancelled",
        resultText: json.result_text,
      });
      toast.success(decision === "confirm" ? "Done" : "Cancelled");
    } catch (e) {
      const err = e instanceof Error ? e.message : "Network error";
      onUpdate({ ...confirm, status: "failed", resultText: err });
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="my-3 rounded-2xl border border-border bg-accent/30 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 text-primary" />
        <span>{meta.label}</span>
      </div>
      <div className="mt-1 text-foreground">{confirm.summary}</div>
      {(preview.to || preview.subject || preview.body_preview || preview.start || preview.location) && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {typeof preview.to === "string" && <div><span className="font-medium text-foreground">To:</span> {preview.to}</div>}
          {typeof preview.cc === "string" && preview.cc && <div><span className="font-medium text-foreground">Cc:</span> {preview.cc}</div>}
          {typeof preview.subject === "string" && <div><span className="font-medium text-foreground">Subject:</span> {preview.subject}</div>}
          {typeof preview.body_preview === "string" && (
            <div className="whitespace-pre-wrap rounded-md bg-background/60 p-2 max-h-32 overflow-y-auto"><span className="font-medium text-foreground">Body: </span>{preview.body_preview}</div>
          )}
          {typeof preview.start === "string" && <div><span className="font-medium text-foreground">Start:</span> {preview.start}</div>}
          {typeof preview.end === "string" && preview.end && <div><span className="font-medium text-foreground">End:</span> {String(preview.end)}</div>}
          {typeof preview.location === "string" && preview.location && <div><span className="font-medium text-foreground">Where:</span> {preview.location}</div>}
          {Array.isArray(preview.attendees) && (preview.attendees as string[]).length > 0 && (
            <div><span className="font-medium text-foreground">Attendees:</span> {(preview.attendees as string[]).join(", ")}</div>
          )}
        </div>
      )}
      {isTerminal ? (
        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
          confirm.status === "confirmed" ? "bg-primary/10 text-primary" :
          confirm.status === "cancelled" ? "bg-muted text-muted-foreground" :
          "bg-destructive/10 text-destructive"
        }`}>
          {confirm.status === "confirmed" ? <Check className="h-3 w-3" /> : confirm.status === "cancelled" ? <X className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {confirm.resultText ?? (confirm.status === "confirmed" ? "Done" : confirm.status === "cancelled" ? "Cancelled" : "Failed")}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => decide("confirm")}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy === "confirm" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {confirm.tool === "calendar_delete_event" ? "Delete" : confirm.tool === "gmail_send" ? "Send" : "Confirm"}
          </button>
          <button
            onClick={() => decide("cancel")}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy === "cancel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
