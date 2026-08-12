import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";

const safe = /^[a-zA-Z0-9_-]{12,128}$/;
const page = {
  path: "/share",
  title: "Shared conversation unavailable",
  description: "A private-by-default KovaGPT share route.",
  family: "share",
  eyebrow: "Shared content",
  summary:
    "This share has expired, was removed, or is not available. KovaGPT never lists private conversations here.",
  sections: [
    {
      heading: "Privacy first",
      body: "Only an explicitly published share can be displayed. Guessing an identifier never exposes a private chat.",
    },
  ],
  cta: { label: "Open KovaGPT", href: "/" },
};

export const Route = createFileRoute("/share/$shareId")({
  beforeLoad: ({ params }) => {
    if (!safe.test(params.shareId)) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Shared KovaGPT conversation" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <PublicPageTemplate page={page} />,
});
