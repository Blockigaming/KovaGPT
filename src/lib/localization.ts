/**
 * Localization preferences (spec §75): language, reading direction, time zone, time format,
 * date order, currency, units and formatting helpers built on Intl. English labels are inline;
 * other languages load on demand so the first page stays small.
 */
import { useSyncExternalStore } from "react";
import { SUPPORTED_LOCALES, RTL_LOCALES, type SupportedLocale } from "@/lib/locales";

export type Localization = {
  language: "auto" | SupportedLocale;
  direction: "auto" | "ltr" | "rtl";
  timeZone: string; // "auto" or an IANA zone
  hourCycle: "auto" | "h12" | "h23";
  dateOrder: "auto" | "mdy" | "dmy" | "ymd";
  currency: string; // "auto" or ISO 4217
  units: "auto" | "metric" | "imperial";
};

export const DEFAULT_LOCALIZATION: Localization = {
  language: "auto",
  direction: "auto",
  timeZone: "auto",
  hourCycle: "auto",
  dateOrder: "auto",
  currency: "auto",
  units: "auto",
};

const KEY = "kova:localization:v1";
const listeners = new Set<() => void>();
let current: Localization = DEFAULT_LOCALIZATION;
let snapshot = JSON.stringify(current);
let labels: Record<string, string> | null = null;
let labelsFor: SupportedLocale = "en";

function read(): Localization {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOCALIZATION;
    const parsed = JSON.parse(raw) as Partial<Localization>;
    const merged = { ...DEFAULT_LOCALIZATION, ...parsed };
    if (merged.language !== "auto" && !SUPPORTED_LOCALES.includes(merged.language))
      merged.language = "auto";
    return merged;
  } catch {
    return DEFAULT_LOCALIZATION;
  }
}

function emit() {
  snapshot = JSON.stringify(current);
  for (const listener of listeners) listener();
}

export function subscribeLocalization(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const localizationSnapshot = () => snapshot;
export const getLocalization = () => current;

/** The language actually used: the chosen one, else the closest supported browser language. */
export function effectiveLanguage(prefs: Localization = current): SupportedLocale {
  if (prefs.language !== "auto") return prefs.language;
  const wanted = typeof navigator === "undefined" ? ["en"] : (navigator.languages ?? ["en"]);
  for (const tag of wanted) {
    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = tag.split("-")[0].toLowerCase();
    const loose = SUPPORTED_LOCALES.find((locale) => locale.split("-")[0] === base);
    if (loose) return loose;
  }
  return "en";
}

export function effectiveDirection(prefs: Localization = current): "ltr" | "rtl" {
  if (prefs.direction !== "auto") return prefs.direction;
  return RTL_LOCALES.has(effectiveLanguage(prefs)) ? "rtl" : "ltr";
}

function applyDocument() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.lang = effectiveLanguage();
  root.dir = effectiveDirection();
  root.dataset.kovaUnits =
    current.units !== "auto" ? current.units : effectiveLanguage() === "en" ? "imperial" : "metric";
}

async function loadLabels() {
  const language = effectiveLanguage();
  if (language === "en") {
    const hadLabels = labels !== null;
    labels = null;
    labelsFor = "en";
    emit();
    if (hadLabels) {
      const { applyInterfaceTranslation } = await import("@/lib/dom-translator");
      applyInterfaceTranslation({});
    }
    return;
  }
  const [{ LOCALIZED_LABELS }, appLabels, { HELP_LABELS }, { applyInterfaceTranslation }] =
    await Promise.all([
      import("@/lib/localization-labels"),
      import("@/lib/localization-app-labels").then((m) => m.loadAppLabels(language)),
      import("@/lib/localization-help-labels"),
      import("@/lib/dom-translator"),
    ]);
  if (effectiveLanguage() !== language) return;
  labels = {
    ...(HELP_LABELS[language] ?? {}),
    ...appLabels,
    ...(LOCALIZED_LABELS[language] ?? {}),
  };
  labelsFor = language;
  emit();
  // Everything rendered without t() is translated in place from the same labels.
  applyInterfaceTranslation(labels);
}

let started = false;
/** Reads saved preferences once on the client and applies language and direction. */
export function startLocalization() {
  if (started || typeof window === "undefined") return;
  started = true;
  current = read();
  applyDocument();
  emit();
  if (effectiveLanguage() !== "en") void loadLabels();
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    current = read();
    applyDocument();
    void loadLabels();
  });
}

export function setLocalization(patch: Partial<Localization>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this tab.
  }
  applyDocument();
  emit();
  void loadLabels();
}

/** Translated label for a key; English text is the key itself. */
export function t(english: string): string {
  if (!labels || labelsFor !== effectiveLanguage()) return english;
  return labels[english] ?? english;
}

/** Re-renders the caller when language or formats change. */
export function useLocalization() {
  return useSyncExternalStore(subscribeLocalization, localizationSnapshot, () => SERVER_SNAPSHOT);
}
const SERVER_SNAPSHOT = JSON.stringify(DEFAULT_LOCALIZATION);
