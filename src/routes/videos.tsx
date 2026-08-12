import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/videos",
  title: "Videos",
  description: "Verified KovaGPT videos publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/videos")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="videos" />,
});
