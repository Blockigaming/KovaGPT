import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Sparkles, Clock } from "lucide-react";
import { useEffect, useState } from "react";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "any moment now";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function LimitReachedDialog({
  open,
  onOpenChange,
  kind = "image",
  resetsAt,
  message,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind?: "image" | "chat" | "upload";
  /** Absolute timestamp (ms) when the quota resets. */
  resetsAt?: number;
  /** Optional override message (e.g. from server). */
  message?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const remaining = resetsAt ? resetsAt - now : 0;
  const title =
    kind === "image"
      ? "You've hit your daily image limit"
      : kind === "upload"
        ? "You've hit your daily upload limit"
        : "You've hit your daily message limit";
  const body =
    message ??
    "You've reached your current plan limit. Upgrade to continue with higher usage limits and more features.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden border border-border/60">
        <div
          aria-hidden
          className="h-24 relative"
          style={{
            background:
              "radial-gradient(120% 100% at 0% 0%, hsl(var(--primary) / 0.35), transparent 60%), radial-gradient(120% 100% at 100% 100%, hsl(var(--primary) / 0.2), transparent 55%), linear-gradient(135deg, var(--color-background), var(--color-muted))",
          }}
        >
          <div className="absolute -bottom-6 left-6 w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/40 shadow-lg flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary-foreground" />
          </div>
        </div>
        <div className="px-6 pt-10 pb-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{body}</p>

          {resetsAt && (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Clock className="w-3.5 h-3.5" />
              Resets in <span className="font-medium text-foreground">{formatCountdown(remaining)}</span>
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Not now
            </Button>
            <Button asChild className="flex-1">
              <Link to="/pricing" onClick={() => onOpenChange(false)}>
                Upgrade to Pro
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
