// Lightweight OpenStreetMap embed. Uses the current principal's saved
// approximate location from Settings and falls back to a truthful empty state.
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import {
  LOCATION_KEY_BASE,
  LOCATION_STORAGE_CHANGED_EVENT,
  loadPrincipalStoredRecord,
  principalStorageKey,
} from "@/lib/settings-storage";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type Loc = { lat: number; lon: number };

function parseStoredLocation(stored: Record<string, unknown> | null): Loc | null {
  const lat = stored?.lat;
  const lon = stored?.lon;
  if (
    stored?.enabled !== true ||
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }
  return { lat, lon };
}

export function MapWidget({
  height = 180,
  userKey,
  principalResolved,
}: {
  height?: number;
  userKey: string | null;
  principalResolved: boolean;
}) {
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const [loaded, setLoaded] = useState<{ principal: string; location: Loc | null } | null>(null);

  useEffect(() => {
    setLoaded(null);
    if (!principalResolved || !principal) return;

    const refresh = () => {
      const stored = loadPrincipalStoredRecord(LOCATION_KEY_BASE, userKey, {
        migrateLegacyGuest: userKey === null,
      });
      setLoaded({ principal, location: parseStoredLocation(stored) });
    };
    const storageKey = principalStorageKey(LOCATION_KEY_BASE, userKey);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    const onLocationChanged = () => refresh();
    const onPrincipalCleared = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      setLoaded({ principal, location: null });
    };

    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCATION_STORAGE_CHANGED_EVENT, onLocationChanged);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onPrincipalCleared);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LOCATION_STORAGE_CHANGED_EVENT, onLocationChanged);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onPrincipalCleared);
    };
  }, [principal, principalResolved, userKey]);

  const ready = principal !== null && loaded?.principal === principal;
  const loc = ready ? loaded.location : null;
  if (!ready || !loc) {
    return (
      <div
        className="rounded-xl border border-white/5 bg-black/40 flex items-center justify-center text-xs text-neutral-400 gap-2"
        style={{ height }}
        role={!ready ? "status" : undefined}
      >
        <MapPin className="w-4 h-4" aria-hidden="true" />
        <span>
          {ready
            ? "Enable location in Settings to see your map here."
            : "Loading your saved location…"}
        </span>
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
        title="Your approximate location"
        src={src}
        className="w-full h-full block"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
