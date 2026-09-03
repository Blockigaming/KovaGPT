import { MapPin } from "lucide-react";

export function MapWidget({ height = 180 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 text-center text-xs text-muted-foreground"
      style={{ height }}
      role="status"
    >
      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Map previews are not available yet. No saved device location is used.</span>
    </div>
  );
}
