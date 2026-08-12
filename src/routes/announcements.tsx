import { createFileRoute } from "@tanstack/react-router";
import { PublicationIndex } from "@/components/PublicationIndex";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/announcements",
  title: "Announcements",
  description: "Verified KovaGPT announcements publications.",
  family: "publishing",
  eyebrow: "Publications",
  summary: "Reviewed KovaGPT publications.",
  sections: [],
};
export const Route = createFileRoute("/announcements")({
  head: () => publicPageHead(page),
  component: () => <PublicationIndex family="announcements" />,
});
