import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Building2,
  Layers3,
  LocateFixed,
  MapPin,
  Satellite,
  Sparkles,
} from "lucide-react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { useUser } from "@/components/auth/ClerkSafe";
import { authFetch } from "@/lib/auth-fetch";
import { safeBrowserStorage, writePrincipalHandoff } from "@/lib/principal-browser-storage.mjs";

const VECTOR_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri",
    },
  },
  layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
};

type Place = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  address: Record<string, string>;
  bounds: [number, number, number, number] | null;
};

type ViewContext = {
  center: { latitude: number; longitude: number };
  bounds: { west: number; south: number; east: number; north: number };
  zoom: number;
};

function set3dResources(map: MapLibreMap, enabled: boolean) {
  map.setTerrain(
    enabled && map.getSource("terrain") ? { source: "terrain", exaggeration: 1.15 } : null,
  );
  if (map.getLayer("kova-3d-buildings")) {
    map.setLayoutProperty("kova-3d-buildings", "visibility", enabled ? "visible" : "none");
  }
}

function addMapEnhancements(map: MapLibreMap, threeD: boolean) {
  if (threeD && !map.getSource("terrain")) {
    map.addSource("terrain", {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
    });
  }
  if (!map.getLayer("kova-3d-buildings") && map.getSource("openmaptiles")) {
    const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addLayer(
      {
        id: "kova-3d-buildings",
        source: "openmaptiles",
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#b8c2cc",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.72,
        },
      },
      labelLayer,
    );
  }
  set3dResources(map, threeD);
}

export function KovaMaps() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const principalRef = useRef("pending");
  const searchAbortRef = useRef<AbortController | null>(null);
  const threeDRef = useRef(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [view, setView] = useState<ViewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [threeD, setThreeD] = useState(true);
  threeDRef.current = threeD;
  const [networkPolicy, setNetworkPolicy] = useState<{
    principal: string;
    allowed: boolean;
    message: string | null;
  } | null>(null);
  const navigate = useNavigate();
  const { isLoaded, user } = useUser();
  const principal = !isLoaded ? "pending" : user?.id ? `user:${user.id}` : "guest";
  principalRef.current = principal;
  const networkAllowed = networkPolicy?.principal === principal ? networkPolicy.allowed : null;

  useEffect(() => {
    if (!isLoaded) return;
    searchAbortRef.current?.abort();
    markerRef.current?.remove();
    markerRef.current = null;
    setQuery("");
    setResults([]);
    setSelected(null);
    setView(null);
    setError(null);
    setSearching(false);
    setLoading(true);
    setSatellite(false);
    setThreeD(true);
    setNetworkPolicy(null);
    if (!user) {
      setNetworkPolicy({ principal, allowed: true, message: null });
      return;
    }
    const controller = new AbortController();
    const blockNetwork = (message: string) => {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      setResults([]);
      setSelected(null);
      setView(null);
      setSearching(false);
      setLoading(false);
      setNetworkPolicy({ principal, allowed: false, message });
    };
    const checkPolicy = async () => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
        const response = await authFetch("/api/security/lockdown", { signal });
        const payload = (await response.json().catch(() => null)) as { enabled?: boolean } | null;
        if (controller.signal.aborted || principalRef.current !== principal) return;
        if (!response.ok || typeof payload?.enabled !== "boolean") {
          blockNetwork("KovaGPT could not verify Lockdown Mode. Try again shortly.");
          return;
        }
        if (payload.enabled) {
          blockNetwork(
            "Maps is unavailable while Lockdown Mode is on. Turn it off in Settings to load network map data.",
          );
          return;
        }
        if (!payload.enabled && !mapRef.current) setLoading(true);
        setNetworkPolicy({
          principal,
          allowed: true,
          message: null,
        });
      } catch {
        if (!controller.signal.aborted && principalRef.current === principal) {
          blockNetwork("KovaGPT could not verify Lockdown Mode. Try again shortly.");
        }
      }
    };
    void checkPolicy();
    const interval = window.setInterval(() => void checkPolicy(), 15_000);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkPolicy();
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [isLoaded, principal, user?.id]);

  useEffect(() => {
    if (networkAllowed !== true || !containerRef.current || mapRef.current) return;
    const mapPrincipal = principal;
    let disposed = false;
    let loadTimeout: number | null = null;
    const isCurrent = () => !disposed && principalRef.current === mapPrincipal;
    void import("maplibre-gl")
      .then((maplibregl) => {
        if (!isCurrent() || !containerRef.current) return;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: VECTOR_STYLE,
          center: [-71.0589, 42.3601],
          zoom: 12,
          pitch: 42,
          bearing: -8,
          attributionControl: { compact: true },
          maxPitch: 70,
        });
        mapRef.current = map;
        loadTimeout = window.setTimeout(() => {
          if (!isCurrent()) return;
          setLoading(false);
          setError("Map data is taking too long to load. Check your connection and try again.");
        }, 12_000);
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new maplibregl.FullscreenControl(), "top-right");
        const updateView = () => {
          if (!isCurrent()) return;
          const center = map.getCenter();
          const bounds = map.getBounds();
          setView({
            center: { latitude: center.lat, longitude: center.lng },
            bounds: {
              west: bounds.getWest(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              north: bounds.getNorth(),
            },
            zoom: map.getZoom(),
          });
        };
        map.on("load", () => {
          if (!isCurrent()) return;
          if (loadTimeout !== null) window.clearTimeout(loadTimeout);
          addMapEnhancements(map, threeDRef.current);
          setLoading(false);
          updateView();
        });
        map.on("moveend", updateView);
        map.on("error", (event) => {
          if (!isCurrent()) return;
          console.error("[maps] map provider error", event.error?.message ?? "unknown");
          setError("Some map data could not load. Check your connection and try again.");
          setLoading(false);
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        setError("Maps could not start in this browser. Refresh the page or try another browser.");
        setLoading(false);
      });
    return () => {
      disposed = true;
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [networkAllowed, principal]);

  const selectPlace = async (place: Place) => {
    const map = mapRef.current;
    if (!map) return;
    const selectionPrincipal = principal;
    const maplibregl = await import("maplibre-gl");
    if (principalRef.current !== selectionPrincipal || mapRef.current !== map) return;
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#1685fb" })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);
    setSelected(place);
    if (place.bounds) {
      map.fitBounds(
        [
          [place.bounds[0], place.bounds[1]],
          [place.bounds[2], place.bounds[3]],
        ],
        {
          padding: 90,
          maxZoom: 17,
          duration: 1300,
          pitch: threeD ? 48 : 0,
        },
      );
    } else {
      map.flyTo({
        center: [place.longitude, place.latitude],
        zoom: 16,
        pitch: threeD ? 48 : 0,
        duration: 1300,
      });
    }
  };

  const search = async () => {
    if (networkAllowed !== true) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter a location, address, or place to search.");
      return;
    }
    setSearching(true);
    setError(null);
    markerRef.current?.remove();
    markerRef.current = null;
    setSelected(null);
    setResults([]);
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestPrincipal = principal;
    try {
      const response = await authFetch(`/api/maps/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      const payload = (await response.json()) as { results?: Place[]; error?: string };
      if (principalRef.current !== requestPrincipal) return;
      if (!response.ok) throw new Error(payload.error);
      const next = payload.results ?? [];
      setResults(next);
      if (!next.length)
        setError("No matching places were found. Check the spelling or add a city or country.");
      else await selectPlace(next[0]);
    } catch (caught) {
      if (controller.signal.aborted || principalRef.current !== requestPrincipal) return;
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Place search is unavailable. Try again.",
      );
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearching(false);
      }
    }
  };

  const askKova = () => {
    if (!isLoaded || networkAllowed !== true) return;
    const context = {
      searchedLocation: query.trim() || null,
      selectedLocation: selected
        ? {
            name: selected.name,
            latitude: selected.latitude,
            longitude: selected.longitude,
            type: selected.type,
          }
        : null,
      viewport: view,
    };
    const prompt = `${query.trim() || "What is around here?"}\n\nMap context (provider-resolved; do not invent places or coordinates):\n${JSON.stringify(context, null, 2)}`;
    const written = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-app-chat-context",
      user?.id ?? null,
      prompt,
    );
    if (!written.ok) {
      setError("Kova could not receive the map context. Please try again.");
      return;
    }
    navigate({ to: "/" });
  };

  const toggleStyle = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !satellite;
    const stylePrincipal = principal;
    setSatellite(next);
    map.setStyle(next ? SATELLITE_STYLE : VECTOR_STYLE);
    map.once("style.load", () => {
      if (principalRef.current !== stylePrincipal || mapRef.current !== map) return;
      if (!next) addMapEnhancements(map, threeD);
      if (selected) void selectPlace(selected);
    });
  };

  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !threeD;
    setThreeD(next);
    map.easeTo({ pitch: next ? 48 : 0, bearing: next ? -8 : 0, duration: 700 });
    if (next && !satellite) addMapEnhancements(map, true);
    else set3dResources(map, false);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError("Current location is not supported by this browser.");
      return;
    }
    const requestPrincipal = principal;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (principalRef.current !== requestPrincipal || networkAllowed !== true) return;
        setError(null);
        setQuery("");
        setResults([]);
        void selectPlace({
          id: "current-location",
          name: "Current location",
          latitude: coords.latitude,
          longitude: coords.longitude,
          type: "current location",
          address: {},
          bounds: null,
        });
      },
      () => {
        if (principalRef.current === requestPrincipal)
          setError(
            "Location access was denied or unavailable. You can still search by place or address.",
          );
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 },
    );
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative h-full min-h-0 flex-1 overflow-hidden bg-background"
    >
      <div
        ref={containerRef}
        data-testid="map-container"
        className="absolute inset-0 bg-muted"
        aria-label="Interactive map"
      />
      {networkAllowed !== true ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-background p-8 text-center">
          <div className="max-w-sm rounded-2xl border bg-card p-6 shadow-xl">
            <MapPin className="mx-auto mb-3 h-7 w-7 text-primary" />
            <h1 className="font-semibold">
              {networkAllowed === null ? "Checking Maps access" : "Maps unavailable"}
            </h1>
            {networkPolicy?.message ? (
              <p className="mt-2 text-sm text-muted-foreground">{networkPolicy.message}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-background/80 text-sm text-muted-foreground">
          Loading real map data…
        </div>
      ) : null}
      {error && !mapRef.current ? (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <div className="max-w-sm rounded-2xl border bg-card p-6 shadow-xl">
            <MapPin className="mx-auto mb-3 h-7 w-7 text-primary" />
            <h1 className="font-semibold">Maps unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3 pt-[max(.75rem,env(safe-area-inset-top))] sm:p-5">
        <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-border/70 bg-background/90 p-2 shadow-xl backdrop-blur-xl">
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Sparkles className="ml-2 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask Kova about Maps"
              aria-label="Ask Kova about Maps"
              className="h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={searching || networkAllowed !== true}
              aria-label="Search maps"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
          {error && mapRef.current ? (
            <p role="alert" className="px-3 pb-1 pt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {results.length > 1 ? (
            <div className="mt-1 max-h-36 overflow-y-auto border-t px-1 pt-1">
              {results.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => void selectPlace(place)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="line-clamp-2">{place.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-end gap-2 sm:bottom-5 sm:left-5">
        {selected && networkAllowed === true ? (
          <section className="max-w-sm rounded-2xl border border-border/70 bg-background/92 p-4 shadow-xl backdrop-blur-xl">
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h1 className="line-clamp-2 text-sm font-semibold">{selected.name}</h1>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  {selected.type.replaceAll("_", " ")} · {selected.latitude.toFixed(5)},{" "}
                  {selected.longitude.toFixed(5)}
                </p>
                <button
                  type="button"
                  onClick={askKova}
                  disabled={!isLoaded || networkAllowed !== true}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Ask Kova with map context
                </button>
              </div>
            </div>
          </section>
        ) : null}
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={locate}
            disabled={networkAllowed !== true}
            aria-label="Use my current location"
            title="Use my current location"
            className="grid h-10 w-10 place-items-center rounded-xl border bg-background/92 shadow-lg backdrop-blur"
          >
            <LocateFixed className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggle3d}
            disabled={networkAllowed !== true}
            aria-pressed={threeD}
            aria-label={threeD ? "Switch to 2D" : "Switch to 3D"}
            className="grid h-10 w-10 place-items-center rounded-xl border bg-background/92 shadow-lg backdrop-blur"
          >
            {threeD ? (
              <Building2 className="h-4 w-4 text-primary" />
            ) : (
              <Layers3 className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleStyle}
            disabled={networkAllowed !== true}
            aria-pressed={satellite}
            aria-label={satellite ? "Show street map" : "Show satellite imagery"}
            className="grid h-10 w-10 place-items-center rounded-xl border bg-background/92 shadow-lg backdrop-blur"
          >
            <Satellite className={satellite ? "h-4 w-4 text-primary" : "h-4 w-4"} />
          </button>
        </div>
      </div>
    </main>
  );
}
