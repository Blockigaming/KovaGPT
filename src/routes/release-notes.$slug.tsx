import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/release-notes/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("release-notes", params.slug),
});
