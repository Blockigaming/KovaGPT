import { createFileRoute } from "@tanstack/react-router";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";

const page = {
  path: "/maps",
  title: "Maps preview",
  description: "A noindex preview of map-supported planning in KovaGPT.",
  family: "product",
  eyebrow: "Preview",
  summary: "Map-supported planning is not publicly available yet.",
  sections: [
    {
      heading: "No location access",
      body: "This preview does not request, infer, store, or transmit your device location.",
    },
    {
      heading: "Plan safely",
      body: "Use KovaGPT to organize place names you provide, then verify routes, opening hours, accessibility, and safety with an authoritative map provider.",
    },
  ],
  cta: { label: "Return to KovaGPT", href: "/" },
};
export const Route = createFileRoute("/maps")({
  head: () => ({
    ...publicPageHead(page),
    meta: [...publicPageHead(page).meta, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => <PublicPageTemplate page={page} />,
});
