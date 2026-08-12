import { createFileRoute } from "@tanstack/react-router";
import { requirePublishedArticle } from "@/lib/publication-route";
export const Route = createFileRoute("/engineering/$slug")({
  beforeLoad: ({ params }) => requirePublishedArticle("engineering", params.slug),
});
