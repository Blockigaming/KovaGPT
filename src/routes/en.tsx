import { createFileRoute } from "@tanstack/react-router";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/en",
  title: "KovaGPT",
  description:
    "KovaGPT is an independent AI workspace for chat, writing, research, coding, study, and images.",
  family: "product",
  eyebrow: "English",
  summary: "Think, make, and organize work in one focused AI workspace.",
  sections: [
    {
      heading: "English locale",
      body: "English is currently the only complete, reviewed locale. Additional languages remain unavailable until navigation and critical content are fully translated.",
    },
  ],
  cta: { label: "Open KovaGPT", href: "/" },
};
export const Route = createFileRoute("/en")({
  head: () => {
    const h = publicPageHead(page);
    return {
      ...h,
      links: [
        ...(h.links ?? []),
        { rel: "alternate", hrefLang: "en", href: "https://kovagpt.com/en" },
        { rel: "alternate", hrefLang: "x-default", href: "https://kovagpt.com/" },
      ],
    };
  },
  component: () => <PublicPageTemplate page={page} />,
});
