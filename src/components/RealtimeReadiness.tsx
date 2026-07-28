import { CloudOff } from "lucide-react";

export function RealtimeReadiness({ resource }: { resource: "Project" | "Artifact" | "Work" }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] text-muted-foreground"
      title={`${resource} collaboration will reconnect automatically when a realtime adapter is configured.`}
    >
      <CloudOff className="h-3 w-3" />
      Realtime unavailable
    </span>
  );
}
