export type PublicAssistant = {
  slug: string;
  name: string;
  description: string;
  category: string;
  creator: string;
  verified: boolean;
  visibility: "public" | "private" | "removed";
};
// Public entries must come from the KovaGPT publishing workflow. Empty by default: no imported GPTs.
export const PUBLIC_ASSISTANTS: readonly PublicAssistant[] = [];
export const PUBLIC_ASSISTANT_BY_SLUG = new Map(PUBLIC_ASSISTANTS.map((item) => [item.slug, item]));
export function resolveAssistantState(slug: string) {
  const item = PUBLIC_ASSISTANT_BY_SLUG.get(slug);
  return item?.visibility === "public"
    ? { state: "public" as const, item }
    : item?.visibility === "removed"
      ? { state: "removed" as const }
      : { state: "not_found" as const };
}
