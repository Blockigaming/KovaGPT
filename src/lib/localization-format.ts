/** Formatting helpers for spec §75, kept out of the first page; they read the shared preferences. */
import { effectiveLanguage, getLocalization, type Localization } from "@/lib/localization";

const timeZoneOption = (prefs: Localization) =>
  prefs.timeZone === "auto" ? undefined : prefs.timeZone;

/** Intl locale tag including the chosen hour cycle. */
export function intlLocale(prefs: Localization = getLocalization()) {
  return effectiveLanguage(prefs);
}

export function formatDate(
  value: Date | number,
  style: "short" | "medium" | "long" = "medium",
  prefs: Localization = getLocalization(),
) {
  const date = new Date(value);
  const timeZone = timeZoneOption(prefs);
  if (prefs.dateOrder !== "auto" && style === "short") {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const [y, m, d] = [get("year"), get("month"), get("day")];
    return prefs.dateOrder === "ymd"
      ? `${y}-${m}-${d}`
      : prefs.dateOrder === "dmy"
        ? `${d}/${m}/${y}`
        : `${m}/${d}/${y}`;
  }
  return new Intl.DateTimeFormat(intlLocale(prefs), { dateStyle: style, timeZone }).format(date);
}

export function formatTime(value: Date | number, prefs: Localization = getLocalization()) {
  return new Intl.DateTimeFormat(intlLocale(prefs), {
    timeStyle: "short",
    timeZone: timeZoneOption(prefs),
    ...(prefs.hourCycle === "auto" ? {} : { hourCycle: prefs.hourCycle }),
  }).format(new Date(value));
}

export function monthNames(prefs: Localization = getLocalization()) {
  const format = new Intl.DateTimeFormat(intlLocale(prefs), { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, month) => format.format(Date.UTC(2026, month, 15)));
}

export function dayNames(prefs: Localization = getLocalization()) {
  const format = new Intl.DateTimeFormat(intlLocale(prefs), { weekday: "long", timeZone: "UTC" });
  // 2026-11-23 is a Monday.
  return Array.from({ length: 7 }, (_, day) => format.format(Date.UTC(2026, 10, 23 + day)));
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  prefs: Localization = getLocalization(),
) {
  return new Intl.NumberFormat(intlLocale(prefs), options).format(value);
}

export const formatPercent = (ratio: number, prefs: Localization = getLocalization()) =>
  formatNumber(ratio, { style: "percent", maximumFractionDigits: 1 }, prefs);

const REGION_CURRENCY: Record<string, string> = {
  en: "USD",
  es: "EUR",
  fr: "EUR",
  de: "EUR",
  "pt-BR": "BRL",
  ja: "JPY",
  ko: "KRW",
  ar: "SAR",
};

export function currency(prefs: Localization = getLocalization()) {
  return prefs.currency === "auto" ? REGION_CURRENCY[effectiveLanguage(prefs)] : prefs.currency;
}

export const formatCurrency = (value: number, prefs: Localization = getLocalization()) =>
  formatNumber(value, { style: "currency", currency: currency(prefs) }, prefs);

export function units(prefs: Localization = getLocalization()): "metric" | "imperial" {
  if (prefs.units !== "auto") return prefs.units;
  return effectiveLanguage(prefs) === "en" ? "imperial" : "metric";
}

/** Formats a distance given in kilometres in the reader's unit system. */
export function formatDistance(kilometres: number, prefs: Localization = getLocalization()) {
  return units(prefs) === "metric"
    ? formatNumber(
        kilometres,
        { style: "unit", unit: "kilometer", maximumFractionDigits: 1 },
        prefs,
      )
    : formatNumber(
        kilometres * 0.621371,
        { style: "unit", unit: "mile", maximumFractionDigits: 1 },
        prefs,
      );
}

/** Formats a temperature given in Celsius in the reader's unit system. */
export function formatTemperature(celsius: number, prefs: Localization = getLocalization()) {
  return units(prefs) === "metric"
    ? formatNumber(celsius, { style: "unit", unit: "celsius", maximumFractionDigits: 0 }, prefs)
    : formatNumber(
        (celsius * 9) / 5 + 32,
        { style: "unit", unit: "fahrenheit", maximumFractionDigits: 0 },
        prefs,
      );
}

/** Plural category of a count in the current language (one, few, many, other...). */
export const pluralCategory = (count: number, prefs: Localization = getLocalization()) =>
  new Intl.PluralRules(intlLocale(prefs)).select(count);

/** Language-aware string comparison for sorting (handles accents and numbers). */
export function compareText(a: string, b: string, prefs: Localization = getLocalization()) {
  return new Intl.Collator(intlLocale(prefs), { numeric: true, sensitivity: "base" }).compare(a, b);
}

/** Folds case, accents and width so search ignores them (résumé finds resume, ＡＢＣ finds abc). */
export function foldForSearch(text: string, prefs: Localization = getLocalization()) {
  return text
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLocaleLowerCase(intlLocale(prefs));
}

export const searchMatches = (
  text: string,
  query: string,
  prefs: Localization = getLocalization(),
) => foldForSearch(text, prefs).includes(foldForSearch(query, prefs));
