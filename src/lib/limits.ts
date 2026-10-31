import { DAILY_PLAN_ALLOWANCES } from "./plan-usage-policy.mjs";
// Local display hint only. Authoritative quota is the server UTC-day counter.
const KEY = "nova-gpt-usage-v2";
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Usage = { windowStart: number; images: number; uploads: number };

// Free plan limits.
export const DAILY_IMAGE_LIMIT = DAILY_PLAN_ALLOWANCES.free.images;
export const DAILY_UPLOAD_LIMIT = DAILY_PLAN_ALLOWANCES.free.uploads;

function fresh(): Usage {
  return { windowStart: Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS, images: 0, uploads: 0 };
}

function load(owner = "guest"): Usage {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(`${KEY}:${owner}`);
    if (!raw) return fresh();
    const u = JSON.parse(raw) as Usage;
    if (u.windowStart !== Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS) return fresh();
    return u;
  } catch {
    return fresh();
  }
}

function save(u: Usage, owner = "guest") {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${KEY}:${owner}`, JSON.stringify(u));
}

export function getUsage(owner = "guest") {
  const u = load(owner);
  return {
    images: u.images,
    uploads: u.uploads,
    windowStart: u.windowStart,
    resetsAt: u.windowStart + WINDOW_MS,
    // legacy field a few components still reference
    date: new Date(u.windowStart).toISOString().slice(0, 10),
  };
}

export function timeUntilReset(): number {
  const u = load();
  return Math.max(0, u.windowStart + WINDOW_MS - Date.now());
}

export function tryUseImage(): boolean {
  const u = load();
  if (u.images >= DAILY_IMAGE_LIMIT) return false;
  u.images += 1;
  save(u);
  return true;
}

export function tryUseUpload(limit = DAILY_UPLOAD_LIMIT, owner = "guest"): boolean {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const u = load(owner);
  if (u.uploads >= normalizedLimit) return false;
  u.uploads += 1;
  save(u, owner);
  return true;
}
