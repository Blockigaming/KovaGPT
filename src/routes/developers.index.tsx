import { createFileRoute } from "@tanstack/react-router";
import { MarketingLanding } from "@/components/public/MarketingLanding";

export const Route = createFileRoute("/developers/")({
  component: () => <MarketingLanding page="developers" />,
  head: () => ({
    meta: [
      { title: "KovaGPT API | Developer Platform" },
      {
        name: "description",
        content: "Current availability of developer APIs and integration tools for KovaGPT.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/developers" }],
  }),
});
