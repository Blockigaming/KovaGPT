import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/guides/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("guides", params.slug),
});
