import { recordGrowthEvent } from "@/lib/growth-events";

const FEATURE_KEY = "kova:last-feature-before-upgrade";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEDUPE_MS = 30_000;
const recent = new Map<string, number>();

type StoredFeature = {
  feature: string;
  surface?: string;
  at: number;
};

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function trackFeatureUse(feature: string, surface?: string): void {
  const cleanFeature = feature.trim().slice(0, 80);
  const cleanSurface = surface?.trim().slice(0, 80);

  if (!cleanFeature) return;

  const now = Date.now();
  const dedupeKey = `${cleanFeature}:${cleanSurface ?? ""}`;
  const last = recent.get(dedupeKey) ?? 0;

  if (now - last < DEDUPE_MS) return;

  recent.set(dedupeKey, now);

  for (const [key, timestamp] of recent) {
    if (now - timestamp > DEDUPE_MS * 4) {
      recent.delete(key);
    }
  }

  const storage = safeSessionStorage();

  if (storage) {
    try {
      const value: StoredFeature = {
        feature: cleanFeature,
        surface: cleanSurface,
        at: now,
      };
      storage.setItem(FEATURE_KEY, JSON.stringify(value));
    } catch {
      // Attribution storage cannot block product usage.
    }
  }

  void recordGrowthEvent("feature_used", {
    feature: cleanFeature,
    surface: cleanSurface,
  });
}

export function trackFeatureBeforeUpgrade(surface = "upgrade"): void {
  const storage = safeSessionStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(FEATURE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Partial<StoredFeature>;

    if (
      typeof parsed.feature !== "string" ||
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at > MAX_AGE_MS
    ) {
      storage.removeItem(FEATURE_KEY);
      return;
    }

    void recordGrowthEvent("feature_before_upgrade", {
      feature: parsed.feature.slice(0, 80),
      surface: surface.slice(0, 80),
    });
  } catch {
    // Corrupt attribution is ignored.
  }
}
