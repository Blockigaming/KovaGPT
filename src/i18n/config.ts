export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_DIRECTIONS: Record<Locale, "ltr" | "rtl"> = { en: "ltr" };
export const KNOWN_LOCALE_DIRECTIONS: Readonly<Record<string, "ltr" | "rtl">> = {
  en: "ltr",
  ar: "rtl",
};
export const isAvailableLocale = (value: string): value is Locale =>
  SUPPORTED_LOCALES.includes(value as Locale);
export const directionForLocale = (value: string): "ltr" | "rtl" =>
  KNOWN_LOCALE_DIRECTIONS[value] ?? "ltr";
