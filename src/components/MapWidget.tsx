// Lightweight OpenStreetMap embed. Uses saved location from localStorage
// (set via Settings > Location). Falls back to a hint when no location is set.
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";

type Loc = { enabled: boolean; lat?: number; lon?: number; label?: string };

export function MapWidget({ height = 180 }: { height?: number }) {
  const [loc, setLoc] = useState<Loc | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("kova-location");
      if (raw) setLoc(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  if (!loc?.enabled || loc.lat == null || loc.lon == null) {
    return (
      <div
        className="rounded-xl border border-white/5 bg-black/40 flex items-center justify-center text-xs text-neutral-400 gap-2"
        style={{ height }}
      >
        <MapPin className="w-4 h-4" />
        <span>Enable location in Settings to see your map here.</span>
      </div>
    );
  }

  const { lat, lon } = loc;
  const d = 0.02;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;

  return (
    <div className="rounded-xl overflow-hidden border border-white/5" style={{ height }}>
      <iframe
        title="Your location"
        src={src}
        className="w-full h-full block"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
