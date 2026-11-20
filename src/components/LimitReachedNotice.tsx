import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CLOUD_BROWSER_DAILY_LIMIT_MESSAGE } from "@/lib/chat-browser-policy.mjs";
import { ManualCloudBrowser } from "./ManualCloudBrowser";

export function LimitReachedNotice({
  open,
  onOpenChange,
  kind = "image",
  resetsAt,
  message,
  manualBrowser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: "image" | "chat" | "upload" | "browser_limit" | "browser_error" | "browser_usage";
  resetsAt?: number;
  message?: string;
  manualBrowser?: { ownerId: string; url: string };
}) {
  const id = useId();
  const [openedBrowser, setOpenedBrowser] = useState(false);
  const canOpenBrowser = Boolean(manualBrowser);
  const navigate = useNavigate();
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    if (!open || openedBrowser) return;
    let active = true;
    const isBrowser =
      kind === "browser_limit" || kind === "browser_error" || kind === "browser_usage";
    const titles = {
      image: "Image limit reached",
      chat: "Message limit reached",
      upload: "Upload limit reached",
      browser_limit: CLOUD_BROWSER_DAILY_LIMIT_MESSAGE,
      browser_error: "Cloud Browser",
      browser_usage: "Kova usage limit reached",
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
      description:
        kind === "browser_limit"
          ? undefined
          : canOpenBrowser
            ? `${limitMessage} You can still use Cloud Browser manually if you have browser time left.`
            : isBrowser
              ? message
              : `${limitMessage} ${resetMessage}`,
      onDismiss: () => {
        if (active) dismiss();
      },
      action: canOpenBrowser
        ? { label: "Open Cloud Browser", onClick: () => setOpenedBrowser(true) }
        : kind === "browser_error" || kind === "browser_usage"
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
      active = false;
      toast.dismiss(id);
    };
  }, [canOpenBrowser, id, kind, message, navigate, open, openedBrowser, resetsAt]);
  return open && openedBrowser && manualBrowser ? (
    <ManualCloudBrowser
      {...manualBrowser}
      onClose={() => {
        setOpenedBrowser(false);
        onOpenChange(false);
      }}
    />
  ) : null;
}
