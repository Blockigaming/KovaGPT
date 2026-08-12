import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/technical-reports/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("technical-reports", params.slug),
});
