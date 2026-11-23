import type { SupportedLocale } from "@/lib/locales";

/**
 * Translations of the rest of the interface, keyed by the English label.
 * Each language is its own chunk, so a visitor downloads only the language they use.
 */
const loaders = import.meta.glob<Record<string, string>>("./app-labels/*.json", {
  import: "default",
});

export async function loadAppLabels(locale: SupportedLocale): Promise<Record<string, string>> {
  const load = loaders[`./app-labels/${locale}.json`];
  return load ? await load() : {};
}
