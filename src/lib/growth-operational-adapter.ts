type GrowthMetadata = {
  feature?: string;
  surface?: string;
  plan?: string;
  reason?: string;
  referralCode?: string;
  campaign?: string;
};

const CANDIDATE_NAMES = ["queueOperationalEvent"] as const;

type UnknownFunction = (...args: unknown[]) => unknown;

export async function persistGrowthEvent(name: string, metadata: GrowthMetadata): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (navigator.doNotTrack === "1") return false;

  try {
    const module = (await import("@/lib/operational-analytics")) as Record<string, unknown>;

    const candidateName = CANDIDATE_NAMES.find((key) => typeof module[key] === "function");

    if (!candidateName) return false;

    const fn = module[candidateName] as UnknownFunction;
    const eventName = `growth.${name}`.slice(0, 120);
    const surface = (metadata.surface ?? "unknown").slice(0, 80);
    const route = window.location.pathname.slice(0, 160);

    const payload = {
      name: eventName,
      event: eventName,
      eventName,
      eventType: eventName,
      surface,
      route,
      result: "success",
      metadata: {
        ...metadata,
        surface,
      },
    };

    if (fn.length >= 3) {
      await fn(eventName, surface, payload.metadata);
    } else if (fn.length >= 2) {
      await fn(eventName, {
        ...payload.metadata,
        route,
      });
    } else {
      await fn(payload);
    }

    return true;
  } catch {
    return false;
  }
}
