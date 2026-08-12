import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/research",
  title: "Research",
  description: "Verified KovaGPT research publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/research")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="research" />,
});
