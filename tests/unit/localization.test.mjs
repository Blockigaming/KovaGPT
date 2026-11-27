import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function dataModule(path, replacements = {}) {
  let source = stripTypeScriptTypes(await readFile(path, "utf8"));
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const locales = await dataModule("src/lib/locales.ts");
const labelsUrl = `data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(await readFile("src/lib/localization-labels.ts", "utf8")).replace(
    /import type[^;]+;/,
    "",
  ),
).toString("base64")}`;
const localesUrl = `data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(await readFile("src/lib/locales.ts", "utf8")),
).toString("base64")}`;
const appLabelsByLocale = {};
for (const locale of ["es", "fr", "de", "pt-BR", "ja", "ko", "ar"])
  appLabelsByLocale[locale] = JSON.parse(
    await readFile(`src/lib/app-labels/${locale}.json`, "utf8"),
  );
const appLabelsUrl = `data:text/javascript;base64,${Buffer.from(
  `const all = ${JSON.stringify(appLabelsByLocale)}; export async function loadAppLabels(locale) { return all[locale] ?? {}; }`,
).toString("base64")}`;
const helpLabelsUrl = `data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(await readFile("src/lib/localization-help-labels.ts", "utf8")).replace(
    /import type[^;]+;/,
    "",
  ),
).toString("base64")}`;
globalThis.translated = [];
const translatorUrl = `data:text/javascript;base64,${Buffer.from(
  "export function applyInterfaceTranslation(labels) { globalThis.translated.push(Object.keys(labels).length); }",
).toString("base64")}`;
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
};
globalThis.window = { addEventListener() {} };
globalThis.document = { documentElement: { dataset: {} } };
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US"] },
  configurable: true,
});
const coreSource = stripTypeScriptTypes(await readFile("src/lib/localization.ts", "utf8"))
  .replaceAll('"react"', JSON.stringify(pathToFileURL(resolve("node_modules/react/index.js")).href))
  .replaceAll('"@/lib/locales"', JSON.stringify(localesUrl))
  .replaceAll('"@/lib/localization-labels"', JSON.stringify(labelsUrl))
  .replaceAll('"@/lib/localization-app-labels"', JSON.stringify(appLabelsUrl))
  .replaceAll('"@/lib/localization-help-labels"', JSON.stringify(helpLabelsUrl))
  .replaceAll('"@/lib/dom-translator"', JSON.stringify(translatorUrl));
const coreUrl = `data:text/javascript;base64,${Buffer.from(coreSource).toString("base64")}`;
const core = await import(coreUrl);
const format = await dataModule("src/lib/localization-format.ts", {
  '"@/lib/localization"': JSON.stringify(coreUrl),
});
const L = { ...core, ...format };
const labels = (await import(labelsUrl)).LOCALIZED_LABELS;

test("every translated language covers every label", () => {
  const english = Object.keys(labels.es);
  for (const locale of locales.SUPPORTED_LOCALES.filter((code) => code !== "en")) {
    assert.deepEqual(Object.keys(labels[locale]).sort(), [...english].sort(), locale);
    for (const value of Object.values(labels[locale])) assert.ok(value.trim(), locale);
  }
});

test("browser language picks the closest supported language; Arabic reads right to left", () => {
  const prefs = { ...L.DEFAULT_LOCALIZATION };
  navigator.languages = ["pt-PT", "en"];
  assert.equal(L.effectiveLanguage(prefs), "pt-BR");
  navigator.languages = ["ar-SA"];
  assert.equal(L.effectiveDirection(prefs), "rtl");
  assert.equal(L.effectiveDirection({ ...prefs, direction: "ltr" }), "ltr");
  navigator.languages = ["sv-SE"];
  assert.equal(L.effectiveLanguage(prefs), "en");
  navigator.languages = ["en-US"];
});

test("chosen language, direction and units reach the page and storage", async () => {
  L.startLocalization();
  L.setLocalization({ language: "de" });
  assert.equal(document.documentElement.lang, "de");
  assert.equal(document.documentElement.dir, "ltr");
  assert.equal(document.documentElement.dataset.kovaUnits, "metric");
  assert.equal(JSON.parse(store.get("kova:localization:v1")).language, "de");
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(L.t("New chat"), "Neuer Chat");
  assert.equal(L.t("Unknown label"), "Unknown label");
  assert.equal(L.t("Library"), "Bibliothek");
  assert.ok(globalThis.translated.at(-1) > 500, "page text is translated in place");
  L.setLocalization({ language: "ar" });
  assert.equal(document.documentElement.dir, "rtl");
  L.setLocalization({ language: "en" });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(L.t("New chat"), "New chat");
});

test("dates, times, months, days and time zones follow preferences", () => {
  const date = Date.UTC(2026, 10, 23, 18, 5);
  const base = { ...L.DEFAULT_LOCALIZATION, language: "en", timeZone: "America/New_York" };
  assert.equal(L.formatDate(date, "short", { ...base, dateOrder: "dmy" }), "23/11/2026");
  assert.equal(L.formatDate(date, "short", { ...base, dateOrder: "ymd" }), "2026-11-23");
  assert.equal(L.formatDate(date, "short", { ...base, dateOrder: "mdy" }), "11/23/2026");
  assert.match(L.formatTime(date, { ...base, hourCycle: "h23" }), /^13:05$/);
  assert.match(L.formatTime(date, { ...base, hourCycle: "h12" }), /1:05\s?PM/);
  assert.match(
    L.formatTime(date, { ...base, timeZone: "Asia/Tokyo", hourCycle: "h23" }),
    /^03:05$/,
  );
  assert.equal(L.monthNames({ ...base, language: "fr" })[0], "janvier");
  assert.equal(L.dayNames({ ...base, language: "de" })[0], "Montag");
});

test("numbers, currency, percent, units and plurals are locale-aware", () => {
  const de = { ...L.DEFAULT_LOCALIZATION, language: "de" };
  const en = { ...L.DEFAULT_LOCALIZATION, language: "en" };
  assert.equal(L.formatNumber(1234567.5, {}, de), "1.234.567,5");
  assert.equal(L.formatNumber(1234567.5, {}, en), "1,234,567.5");
  assert.match(L.formatCurrency(12.5, de), /12,50\s?€/);
  assert.equal(L.formatCurrency(12.5, { ...en, currency: "GBP" }), "£12.50");
  assert.match(L.formatPercent(0.425, de), /42,5\s?%/);
  assert.match(L.formatDistance(10, en), /6\.2 mi/);
  assert.match(L.formatDistance(10, de), /10 km/);
  assert.match(L.formatTemperature(20, en), /68°F/);
  assert.equal(L.pluralCategory(1, en), "one");
  assert.equal(L.pluralCategory(5, { ...L.DEFAULT_LOCALIZATION, language: "ar" }), "few");
});

test("sorting and search ignore accents and compare numbers naturally", () => {
  const en = { ...L.DEFAULT_LOCALIZATION, language: "en" };
  assert.deepEqual(
    ["item 10", "Éclair", "item 2", "apple"].sort((a, b) => L.compareText(a, b, en)),
    ["apple", "Éclair", "item 2", "item 10"],
  );
  assert.ok(L.searchMatches("Résumé.pdf", "resume", en));
  assert.ok(L.searchMatches("ＡＢＣ report", "abc", en));
  assert.ok(!L.searchMatches("summary", "resume", en));
});

test("code, math and logos stay left to right inside right-to-left pages", async () => {
  const css = await readFile("src/styles/localization.css", "utf8");
  assert.match(css, /\[dir="rtl"\] :is\(pre, code, kbd, samp, \.katex, \.kova-logo/);
  assert.match(css, /:lang\(ar\) body/);
});

test("the rest of the interface has the same labels in every language", async () => {
  const APP_LABELS = appLabelsByLocale;
  assert.match(
    await readFile("src/lib/localization-app-labels.ts", "utf8"),
    /import\.meta\.glob/,
    "each language loads as its own chunk",
  );
  const english = Object.keys(APP_LABELS.es).sort();
  assert.ok(english.length > 500);
  for (const locale of ["fr", "de", "pt-BR", "ja", "ko", "ar"]) {
    assert.deepEqual(Object.keys(APP_LABELS[locale]).sort(), english, locale);
    for (const value of Object.values(APP_LABELS[locale])) assert.ok(value.trim(), locale);
  }
});

test("every help center question and answer is translated in every language", async () => {
  const strip = async (path) =>
    stripTypeScriptTypes(await readFile(path, "utf8")).replace(/import type[^;]+;/, "");
  const { HELP_LABELS } = await import(
    `data:text/javascript;base64,${Buffer.from(await strip("src/lib/localization-help-labels.ts")).toString("base64")}`
  );
  const english = Object.keys(HELP_LABELS.es).sort();
  assert.ok(english.length > 350);
  for (const locale of ["fr", "de", "pt-BR", "ja", "ko", "ar"])
    assert.deepEqual(Object.keys(HELP_LABELS[locale]).sort(), english, locale);
});
