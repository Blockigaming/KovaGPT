import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  notificationDismissalKey,
  rememberNoticeDismissal,
} from "@/lib/notification-dismissal-policy.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";

export function ContextualTip({
  ownerId,
  "data-kova-notice-id": id,
  message,
  onDismiss,
}: {
  ownerId: string;
  "data-kova-notice-id": "quick_tip" | "did_you_know";
  message: string;
  onDismiss: () => void;
}) {
  const group = "onboarding";
  const key = notificationDismissalKey({ accountId: ownerId, id, group });
  const [visibleKey, setVisibleKey] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    const storage = safeBrowserStorage("localStorage");
    try {
      setVisibleKey(storage && storage.getItem(key) !== "1" ? key : null);
    } catch {
      setVisibleKey(null);
    }
  }, [key]);

  if (!key || visibleKey !== key) return null;
  const title = id === "quick_tip" ? "Quick tip" : "Did you know?";
  return (
    <aside
      aria-label={title}
      data-kova-notice-id={id}
      className="max-w-[300px] rounded-lg border border-border bg-muted/30 p-3 text-sm"
    >
      <div role="status" className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 min-h-11"
        onClick={() => {
          rememberNoticeDismissal(safeBrowserStorage("localStorage"), {
            accountId: ownerId,
            id,
            group,
          });
          setVisibleKey(null);
          onDismiss();
        }}
      >
        Got it
      </Button>
    </aside>
  );
}
