import { notFound } from "@tanstack/react-router";
import { getPublishedArticle, type PublicationFamily } from "@/content/publications";

export function requirePublishedArticle(family: PublicationFamily, slug: string) {
  const article = getPublishedArticle(family, slug);
  if (!article) throw notFound();
  return article;
}
