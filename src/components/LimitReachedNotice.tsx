import { useEffect, useId, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

export function LimitReachedNotice({
  open,
  onOpenChange,
  kind = "image",
  resetsAt,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: "image" | "chat" | "upload" | "browser_limit" | "browser_error";
  resetsAt?: number;
  message?: string;
}) {
  const id = useId();
  const navigate = useNavigate();
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const isBrowser = kind === "browser_limit" || kind === "browser_error";
    const titles = {
      image: "Image limit reached",
      chat: "Message limit reached",
      upload: "Upload limit reached",
      browser_limit: "Cloud Browser limit reached",
      browser_error: "Cloud Browser",
    };
    const dismiss = () => onOpenChangeRef.current(false);
    const reset =
      typeof resetsAt === "number" && Number.isFinite(resetsAt) ? new Date(resetsAt) : null;
    const resetMessage = reset
      ? `Next reset: ${reset.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Your device's time zone is used for this display.`
      : "Reset timing is unavailable. Check Usage for the latest account status.";
    const limitMessage = message || "You've reached the current allowance for this feature.";
    toast.message(titles[kind], {
      id,
      duration: Infinity,
      description: isBrowser ? message : `${limitMessage} ${resetMessage}`,
      onDismiss: dismiss,
      action: isBrowser
        ? undefined
        : {
            label: "View plans",
            onClick: () => {
              dismiss();
              void navigate({ to: "/pricing" });
            },
          },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [id, kind, message, navigate, open, resetsAt]);
  return null;
}
