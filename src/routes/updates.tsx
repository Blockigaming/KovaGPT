import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/updates",
  title: "Updates",
  description: "Verified KovaGPT updates publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/updates")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="updates" />,
});
