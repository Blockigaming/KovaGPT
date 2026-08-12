import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/news",
  title: "News",
  description: "Verified KovaGPT news publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/news")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="news" />,
});
