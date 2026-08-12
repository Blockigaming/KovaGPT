import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/research/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("research", params.slug),
});
