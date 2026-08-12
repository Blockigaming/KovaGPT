import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { PublicSite } from "@/components/public/PublicSite";
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
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    return () => {
      document.documentElement.lang = "en";
      document.documentElement.dir = "ltr";
    };
  }, [direction, locale]);
  return (
    <div lang={locale} dir={direction}>
      <PublicSite>
        <main
          id="main-content"
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
            className="mt-8 inline-flex min-h-11 w-fit items-center rounded-full bg-foreground px-5 text-background"
          >
            {copy.open}
          </Link>
          <label className="mt-10 w-fit text-sm">
            <span className="sr-only">Language</span>
            <select
              value={locale}
              onChange={(event) => location.assign(`/${event.target.value}/home`)}
              className="min-h-11 rounded-lg border bg-background px-3"
            >
              {SUPPORTED_LOCALES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </main>
      </PublicSite>
    </div>
  );
}
