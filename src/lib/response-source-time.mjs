// Retrieval is recorded by the producer. Never infer it from publication, the
// response date, or the current time when normalizing live or historical data.
const RFC3339 =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

/** Preserve only bounded, calendar-valid RFC3339 instants that can be displayed. */
export function normalizeSourceRetrievedAt(value) {
  if (typeof value !== "string" || value.length > 80) return undefined;
  const match = RFC3339.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1] ? value : undefined;
}
