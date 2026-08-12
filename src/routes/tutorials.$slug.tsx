import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/tutorials/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("tutorials", params.slug),
});
