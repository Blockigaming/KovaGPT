import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/videos/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("videos", params.slug),
});
