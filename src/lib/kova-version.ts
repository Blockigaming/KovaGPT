export const KOVA_VERSIONS = ["3.5", "3.4", "3.3"] as const;
export type KovaVersion = (typeof KOVA_VERSIONS)[number];
export const DEFAULT_KOVA_VERSION: KovaVersion = "3.5";
const KEY = "kova-version";

export function getKovaVersion(): KovaVersion {
  if (typeof window === "undefined") return DEFAULT_KOVA_VERSION;
  try {
    const v = localStorage.getItem(KEY);
    if (v && (KOVA_VERSIONS as readonly string[]).includes(v)) return v as KovaVersion;
  } catch {
    /* ignore */
  }
  return DEFAULT_KOVA_VERSION;
}

export function setKovaVersion(v: KovaVersion) {
  try {
    localStorage.setItem(KEY, v);
    window.dispatchEvent(new CustomEvent("kova-version", { detail: v }));
  } catch {
    /* ignore */
  }
}

export function useKovaVersionListener(cb: (v: KovaVersion) => void) {
  // Small helper; consumers call in a useEffect.
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<KovaVersion>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener("kova-version", handler);
  return () => window.removeEventListener("kova-version", handler);
}
