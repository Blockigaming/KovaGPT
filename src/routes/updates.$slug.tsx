import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/updates/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("updates", params.slug),
});
