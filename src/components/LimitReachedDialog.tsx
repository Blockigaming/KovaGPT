import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {message || "You've reached the current allowance for this feature."}
          </DialogDescription>
        </DialogHeader>
        {reset ? (
          <p className="text-sm text-muted-foreground">
            Next reset:{" "}
            {reset.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Your
            device's time zone is used for this display.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Reset timing is unavailable. Check Usage for the latest account status.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button asChild>
            <Link to="/pricing" onClick={() => onOpenChange(false)}>
              View plans
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
