import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/safety-evaluations/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("safety-evaluations", params.slug),
});
