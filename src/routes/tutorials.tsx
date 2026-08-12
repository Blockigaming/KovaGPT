import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/tutorials",
  title: "Tutorials",
  description: "Verified KovaGPT tutorials publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/tutorials")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="tutorials" />,
});
