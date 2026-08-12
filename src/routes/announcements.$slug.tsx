import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/announcements/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("announcements", params.slug),
});
