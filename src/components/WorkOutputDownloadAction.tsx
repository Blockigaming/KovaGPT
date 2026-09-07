import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useUser } from "@/components/auth/ClerkSafe";
import { requestWorkSync } from "@/lib/work-sync-client";

export function WorkOutputDownloadAction({ id }: { id: string }) {
  const { user } = useUser();
  const ownerId = user?.id;
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [ownerId]);
  return (
    <DropdownMenuItem
      disabled={busy || !ownerId}
      onSelect={(event) => {
        event.preventDefault();
        const signal = lifetime.current?.signal;
        if (!ownerId || !signal || signal.aborted) return;
        setBusy(true);
        void requestWorkSync(ownerId, `/api/work/output?id=${encodeURIComponent(id)}`, signal)
          .then((value) => {
            if (signal.aborted) return;
            const result = value as { url?: unknown };
            if (typeof result.url !== "string") throw new Error("unavailable");
            const url = new URL(result.url);
            if (url.protocol !== "https:" || url.username || url.password)
              throw new Error("invalid_url");
            window.open(url.toString(), "_blank", "noopener,noreferrer");
          })
          .catch(() => {
            if (!signal.aborted)
              toast.error("This output is unavailable or Project access has changed.");
          })
          .finally(() => {
            if (!signal.aborted) setBusy(false);
          });
      }}
    >
      <Download className="mr-2 h-4 w-4" />
      {busy ? "Checking file access…" : "Open saved Work output"}
    </DropdownMenuItem>
  );
}
