import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/technical-reports",
  title: "Technical Reports",
  description: "Verified KovaGPT technical reports publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/technical-reports")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="technical-reports" />,
});
