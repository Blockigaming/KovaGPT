// 24-hour rolling usage window. The first action of the day starts the
// window; everything resets exactly 24 hours later.
const KEY = "nova-gpt-usage-v2";
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Usage = { windowStart: number; images: number; uploads: number };

// Free plan limits.
export const DAILY_IMAGE_LIMIT = 3;
export const DAILY_UPLOAD_LIMIT = 3;

function fresh(): Usage {
  return { windowStart: Date.now(), images: 0, uploads: 0 };
}

function load(): Usage {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const u = JSON.parse(raw) as Usage;
    if (!u.windowStart || Date.now() - u.windowStart >= WINDOW_MS) return fresh();
    return u;
  } catch {
    return fresh();
  }
}

function save(u: Usage) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function getUsage() {
  const u = load();
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

export function tryUseUpload(limit = DAILY_UPLOAD_LIMIT): boolean {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const u = load();
  if (u.uploads >= normalizedLimit) return false;
  u.uploads += 1;
  save(u);
  return true;
}
