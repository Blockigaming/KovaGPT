import { CloudOff, Radio, RefreshCw } from "lucide-react";
export function CollaborationStatus({
  status,
  peers,
}: {
  status: "connected" | "reconnecting" | "unavailable";
  peers: number;
}) {
  const Icon = status === "connected" ? Radio : status === "reconnecting" ? RefreshCw : CloudOff;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] text-muted-foreground"
    >
      <Icon className="h-3 w-3" />
      {status === "connected"
        ? `Live updates${peers ? ` · ${peers} other${peers === 1 ? "" : "s"} here` : ""}`
        : status === "reconnecting"
          ? "Reconnecting · drafts stay local"
          : "Collaboration unavailable"}
    </span>
  );
}
