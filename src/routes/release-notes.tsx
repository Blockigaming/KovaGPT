import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/release-notes",
  title: "Release Notes",
  description: "Verified KovaGPT release notes publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/release-notes")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="release-notes" />,
});
