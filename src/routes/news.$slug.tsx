import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/news/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("news", params.slug),
});
