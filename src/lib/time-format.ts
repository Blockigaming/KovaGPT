export type TimeFormatPreference = "system" | "12-hour" | "24-hour";

/** Old, missing, and malformed device settings keep the browser's locale default. */
export function timeFormatValue(value: unknown): TimeFormatPreference {
  return value === "12-hour" || value === "24-hour" ? value : "system";
}

/** Display only: never change the instant, locale, date fields, or caller's timezone. */
export function formatDisplayDateTime(
  value: string | number | Date,
  preference: unknown,
  options: Omit<Intl.DateTimeFormatOptions, "hour12" | "hourCycle"> = {},
  locales?: Intl.LocalesArgument,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const format = timeFormatValue(preference);
  return date.toLocaleString(locales, {
    ...options,
    // h23 keeps midnight at 00:00, including locales whose default is h24.
    ...(format === "system" ? {} : { hourCycle: format === "12-hour" ? "h12" : "h23" }),
  });
}
