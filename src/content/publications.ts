export const PUBLICATION_FAMILIES = [
  "engineering",
  "updates",
  "release-notes",
  "research",
  "safety-evaluations",
  "technical-reports",
  "tutorials",
  "guides",
  "case-studies",
  "announcements",
  "news",
  "videos",
] as const;

export type PublicationFamily = (typeof PUBLICATION_FAMILIES)[number];
export type PublicationState = "draft" | "review" | "published";
export type PublicationBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] };

export type Publication = {
  family: PublicationFamily;
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  state: PublicationState;
  robots: "index, follow" | "noindex, nofollow";
  blocks: PublicationBlock[];
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePublication(value: Publication): string[] {
  const errors: string[] = [];
  if (!PUBLICATION_FAMILIES.includes(value.family)) errors.push("unknown family");
  if (!SLUG.test(value.slug)) errors.push("invalid slug");
  if (value.title.trim().length < 8) errors.push("title is too short");
  if (value.summary.trim().length < 24) errors.push("summary is too short");
  if (!ISO_DATE.test(value.publishedAt)) errors.push("invalid publication date");
  if (value.updatedAt && !ISO_DATE.test(value.updatedAt)) errors.push("invalid update date");
  if (value.author.trim().length < 2) errors.push("author is required");
  if (value.blocks.length === 0) errors.push("body is empty");
  if (value.state !== "published" && value.robots !== "noindex, nofollow") {
    errors.push("unpublished content must be noindex");
  }
  return errors;
}

// No verified editorial entries are currently approved for publication. Drafts must be
// added here, validated, reviewed, and promoted before a public detail route can resolve.
export const PUBLICATIONS: readonly Publication[] = [];

export function getPublishedArticle(family: string, slug: string) {
  if (!PUBLICATION_FAMILIES.includes(family as PublicationFamily) || !SLUG.test(slug)) return null;
  const article = PUBLICATIONS.find(
    (entry) => entry.family === family && entry.slug === slug && entry.state === "published",
  );
  return article && validatePublication(article).length === 0 ? article : null;
}
