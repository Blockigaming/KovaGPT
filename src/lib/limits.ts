const KEY = "nova-gpt-usage-v1";

type Usage = { date: string; images: number; uploads: number };

export const DAILY_IMAGE_LIMIT = 3;
export const DAILY_UPLOAD_LIMIT = 2;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load(): Usage {
  if (typeof window === "undefined") return { date: today(), images: 0, uploads: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { date: today(), images: 0, uploads: 0 };
    const u = JSON.parse(raw) as Usage;
    if (u.date !== today()) return { date: today(), images: 0, uploads: 0 };
    return u;
  } catch {
    return { date: today(), images: 0, uploads: 0 };
  }
}

function save(u: Usage) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function getUsage() {
  return load();
}

export function tryUseImage(): boolean {
  const u = load();
  if (u.images >= DAILY_IMAGE_LIMIT) return false;
  u.images += 1;
  save(u);
  return true;
}

export function tryUseUpload(): boolean {
  const u = load();
  if (u.uploads >= DAILY_UPLOAD_LIMIT) return false;
  u.uploads += 1;
  save(u);
  return true;
}
