import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { recordGrowthEvent } from "@/lib/growth-events";

const REASONS = [
  {
    id: "too_expensive",
    label: "The price is too high",
  },
  {
    id: "not_using_enough",
    label: "I am not using KovaGPT enough",
  },
  {
    id: "missing_feature",
    label: "A feature I need is missing",
  },
  {
    id: "technical_issues",
    label: "I experienced technical problems",
  },
  {
    id: "temporary_pause",
    label: "I only need to pause for now",
  },
  {
    id: "switched_product",
    label: "I switched to another product",
  },
  {
    id: "prefer_not_to_say",
    label: "I prefer not to say",
  },
] as const;

export function CancellationFeedbackDialog({
  open,
  onOpenChange,
  onContinue,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => Promise<void> | void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
      return;
    }

    void recordGrowthEvent("subscription_cancel_started", {
      surface: "settings_subscription",
    });
  }, [open]);

  const continueToPortal = async () => {
    if (!reason || busy) return;

    void recordGrowthEvent("subscription_cancel_feedback", {
      surface: "settings_subscription",
      reason,
    });

    onOpenChange(false);
    await onContinue();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Which option best describes why you are considering cancellation? Your answer helps
            improve KovaGPT. Cancellation itself is completed securely in the Stripe billing portal.
          </p>

          <div role="radiogroup" aria-label="Cancellation reason" className="space-y-2">
            {REASONS.map((item) => (
              <label
                key={item.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name="cancellation-reason"
                  value={item.id}
                  checked={reason === item.id}
                  onChange={() => setReason(item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep my subscription
          </Button>

          <Button type="button" disabled={!reason || busy} onClick={() => void continueToPortal()}>
            {busy ? "Opening…" : "Continue to Stripe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
