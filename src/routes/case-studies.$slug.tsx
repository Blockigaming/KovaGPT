import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/case-studies/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("case-studies", params.slug),
});
