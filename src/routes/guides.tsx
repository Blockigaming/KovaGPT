import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/guides",
  title: "Guides",
  description: "Verified KovaGPT guides publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/guides")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="guides" />,
});
