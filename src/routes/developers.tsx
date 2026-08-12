import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_PAGE_BY_PATH } from "@/content/public-pages";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";

const page = PUBLIC_PAGE_BY_PATH.get("/developers")!;
export const Route = createFileRoute("/developers")({
  head: ({ matches }) => (matches.at(-1)?.pathname === "/developers" ? publicPageHead(page) : {}),
  component: () => <PublicPageTemplate page={page} />,
});
