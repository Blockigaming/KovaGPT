import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowUpRight } from "lucide-react";

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
  resetsAt?: number;
  message?: string;
}) {
  const title =
    kind === "image"
      ? "Image limit reached"
      : kind === "upload"
        ? "Upload limit reached"
        : "Message limit reached";
  const reset =
    typeof resetsAt === "number" && Number.isFinite(resetsAt) ? new Date(resetsAt) : null;
  const validReset = reset && Number.isFinite(reset.valueOf()) ? reset : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="kova-limit-explanation"
        className="gap-0 max-w-[460px] rounded-[22px] border border-border bg-popover px-6 pb-6 pt-7 shadow-[var(--shadow-floating)] max-sm:!bottom-0 max-sm:!top-auto max-sm:!left-0 max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!rounded-t-[26px] max-sm:!px-5 max-sm:!pb-[calc(20px+env(safe-area-inset-bottom))] max-sm:!pt-6"
      >
        <div
          className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-secondary text-foreground"
          aria-hidden="true"
        >
          <AlertCircle className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription id="kova-limit-explanation" className="text-sm leading-6">
            {message || "You've reached the current allowance for this feature."}
          </DialogDescription>
        </DialogHeader>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {validReset
            ? `Next reset: ${validReset.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}. Times follow your device's time zone.`
            : "Reset timing isn't available. Check Usage for your latest account status."}
        </p>
        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            className="min-h-11 rounded-full px-6 max-sm:min-h-12"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button asChild className="min-h-11 rounded-full px-6 max-sm:min-h-12">
            <Link to="/pricing" onClick={() => onOpenChange(false)}>
              View plans <ArrowUpRight aria-hidden="true" className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
