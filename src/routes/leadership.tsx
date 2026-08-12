import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_PAGE_BY_PATH } from "@/content/public-pages";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";

const page = PUBLIC_PAGE_BY_PATH.get("/leadership")!;
export const Route = createFileRoute("/leadership")({
  head: () => publicPageHead(page),
  component: () => <PublicPageTemplate page={page} />,
});
