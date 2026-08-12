import type { PublicPage } from "@/content/public-pages";
import { seoLandingHead } from "@/components/seo-landing-head";
export const publicPageHead = (page: PublicPage) =>
  seoLandingHead({
    title: `${page.title} | KovaGPT`,
    description: page.description,
    path: page.path,
  });
