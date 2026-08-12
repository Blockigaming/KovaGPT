import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/case-studies",
  title: "Case Studies",
  description: "Verified KovaGPT case studies publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/case-studies")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="case-studies" />,
});
