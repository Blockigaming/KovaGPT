import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { PublicSite } from "@/components/public/PublicSite";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { resolveLocale, RTL_LOCALES, translations, SUPPORTED_LOCALES } from "@/lib/locales";
export const Route = createFileRoute("/$locale/home")({
  loader: ({ params }) => {
    const locale = resolveLocale(params.locale);
    if (!locale) throw notFound();
    return { locale, copy: translations[locale] };
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.copy.title} | KovaGPT` },
            { name: "description", content: loaderData.copy.description },
            {
              name: "robots",
              content: "noindex, follow",
            },
          ],
          links: [
            { rel: "canonical", href: `https://kovagpt.com/${loaderData.locale}/home` },
            ...SUPPORTED_LOCALES.map((locale) => ({
              rel: "alternate",
              hrefLang: locale,
              href: `https://kovagpt.com/${locale}/home`,
            })),
            { rel: "alternate", hrefLang: "x-default", href: "https://kovagpt.com/en/home" },
          ],
        }
      : {},
  component: LocaleHome,
});
function LocaleHome() {
  const { locale, copy } = Route.useLoaderData();
  const direction = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  return (
    <PublicSite>
      <main
        id="main-content"
        lang={locale}
        dir={direction}
        className="mx-auto flex min-h-[70vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6"
        tabIndex={-1}
      >
        <p className="font-semibold text-muted-foreground">{copy.product}</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
          {copy.title}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{copy.description}</p>
        <Link
          to="/"
          className="kova-button mt-8 inline-flex min-h-11 w-fit items-center rounded-full bg-foreground px-5 text-background"
        >
          {copy.open}
        </Link>
        <label className="mt-10 w-fit text-sm">
          <span lang="en" className="sr-only" id="locale-language-label">
            Language
          </span>
          <SearchablePicker
            aria-labelledby="locale-language-label"
            value={locale}
            dir={direction}
            options={SUPPORTED_LOCALES.map((item) => ({ value: item, label: item }))}
            onValueChange={(value) => {
              const nextLocale = resolveLocale(value);
              if (nextLocale) location.assign(`/${nextLocale}/home`);
            }}
            searchLabel="Search languages"
            emptyText="No languages found."
            className="min-h-11 rounded-lg border bg-background px-3 text-start"
          />
        </label>
      </main>
    </PublicSite>
  );
}
