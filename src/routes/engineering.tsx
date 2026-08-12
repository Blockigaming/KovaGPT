import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/engineering",
  title: "Engineering",
  description: "Verified KovaGPT engineering publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/engineering")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="engineering" />,
});
