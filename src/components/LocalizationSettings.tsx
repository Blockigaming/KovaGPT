import { useEffect, useSyncExternalStore } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/locales";
import {
  compareText,
  currency,
  dayNames,
  formatCurrency,
  formatDate,
  formatDistance,
  formatNumber,
  formatPercent,
  formatTemperature,
  formatTime,
  monthNames,
  pluralCategory,
  searchMatches,
} from "@/lib/localization-format";
import {
  effectiveDirection,
  effectiveLanguage,
  getLocalization,
  localizationSnapshot,
  setLocalization,
  startLocalization,
  subscribeLocalization,
  t,
  type Localization,
} from "@/lib/localization";
import "@/styles/localization-settings.css";

const LANGUAGE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
};

const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Riyadh",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "UTC",
];
const CURRENCIES = ["USD", "EUR", "GBP", "BRL", "JPY", "KRW", "SAR", "CAD", "AUD"];
const SAMPLE = new Date(Date.UTC(2026, 10, 23, 18, 5));

/** Spec §75: language, direction, time, date, number, currency and unit preferences. */
export function LocalizationSettings() {
  useEffect(startLocalization, []);
  useSyncExternalStore(subscribeLocalization, localizationSnapshot, localizationSnapshot);
  const prefs = getLocalization();
  const auto = t("Automatic");
  const rows: {
    key: keyof Localization;
    label: string;
    options: [string, string][];
  }[] = [
    {
      key: "language",
      label: t("Language"),
      options: [
        ["auto", `${auto} (${LANGUAGE_NAMES[effectiveLanguage({ ...prefs, language: "auto" })]})`],
        ...SUPPORTED_LOCALES.map((code): [string, string] => [code, LANGUAGE_NAMES[code]]),
      ],
    },
    {
      key: "direction",
      label: t("Reading direction"),
      options: [
        ["auto", auto],
        ["ltr", t("Left to right")],
        ["rtl", t("Right to left")],
      ],
    },
    {
      key: "timeZone",
      label: t("Time zone"),
      options: [["auto", auto], ...ZONES.map((zone): [string, string] => [zone, zone])],
    },
    {
      key: "hourCycle",
      label: t("Time format"),
      options: [
        ["auto", auto],
        ["h12", t("12-hour")],
        ["h23", t("24-hour")],
      ],
    },
    {
      key: "dateOrder",
      label: t("Date order"),
      options: [
        ["auto", auto],
        ["mdy", "MM/DD/YYYY"],
        ["dmy", "DD/MM/YYYY"],
        ["ymd", "YYYY-MM-DD"],
      ],
    },
    {
      key: "currency",
      label: t("Currency"),
      options: [["auto", auto], ...CURRENCIES.map((code): [string, string] => [code, code])],
    },
    {
      key: "units",
      label: t("Units"),
      options: [
        ["auto", auto],
        ["metric", t("Metric")],
        ["imperial", t("Imperial")],
      ],
    },
  ];
  const sorted = ["résumé", "Zebra", "apple", "item 10", "item 2", "Éclair"].sort((a, b) =>
    compareText(a, b),
  );
  const partial = effectiveLanguage() !== "en";
  return (
    <section
      className="kova-localization"
      aria-labelledby="localization-heading"
      data-direction={effectiveDirection()}
    >
      <h3 id="localization-heading">{t("Language & region")}</h3>
      {partial && (
        <p className="kova-localization-note">
          {t("Labels in this language are partly translated.")}
        </p>
      )}
      {rows.map(({ key, label, options }) => (
        <div className="kova-preference-row" key={key}>
          <label id={`localization-${key}`} className="font-medium">
            {label}
          </label>
          <Select
            value={String(prefs[key])}
            onValueChange={(value) => setLocalization({ [key]: value } as Partial<Localization>)}
          >
            <SelectTrigger aria-labelledby={`localization-${key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(([value, title]) => (
                <SelectItem key={value} value={value}>
                  <bdi>{title}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <dl className="kova-localization-preview" aria-label={t("Example")}>
        <dt>{t("Date order")}</dt>
        <dd>
          <bdi>
            {formatDate(SAMPLE, "short")} · {formatDate(SAMPLE, "long")}
          </bdi>
        </dd>
        <dt>{t("Time format")}</dt>
        <dd>
          <bdi>{formatTime(SAMPLE)}</bdi>
        </dd>
        <dt>{t("Months")}</dt>
        <dd>
          <bdi>{monthNames().slice(0, 3).join(", ")}…</bdi>
        </dd>
        <dt>{t("Days")}</dt>
        <dd>
          <bdi>{dayNames().slice(0, 3).join(", ")}…</bdi>
        </dd>
        <dt>{t("Numbers")}</dt>
        <dd>
          <bdi>
            {formatNumber(1234567.891)} · {formatPercent(0.425)}
          </bdi>
        </dd>
        <dt>{t("Currency")}</dt>
        <dd>
          <bdi>
            {formatCurrency(1299.5)} <small>({currency()})</small>
          </bdi>
        </dd>
        <dt>{t("Units")}</dt>
        <dd>
          <bdi>
            {formatDistance(5)} · {formatTemperature(21)}
          </bdi>
        </dd>
        <dt>{t("Plurals")}</dt>
        <dd>
          <bdi>
            1 → {pluralCategory(1)}, 2 → {pluralCategory(2)}, 5 → {pluralCategory(5)}
          </bdi>
        </dd>
        <dt>{t("Sorting")}</dt>
        <dd>
          <bdi>{sorted.join(", ")}</bdi>
        </dd>
        <dt>{t("Search matching")}</dt>
        <dd>“resume” → résumé {searchMatches("résumé", "resume") ? "✓" : "✗"}</dd>
        <dt>{t("Mixed-direction text")}</dt>
        <dd>
          <bdi>
            <bdi>KovaGPT مرحبا 2026</bdi> · <code dir="ltr">x = a + b</code>
          </bdi>
        </dd>
      </dl>
    </section>
  );
}
