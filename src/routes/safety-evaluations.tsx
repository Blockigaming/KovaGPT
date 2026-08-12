import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/safety-evaluations",
  title: "Safety Evaluations",
  description: "Verified KovaGPT safety evaluations publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/safety-evaluations")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="safety-evaluations" />,
});
