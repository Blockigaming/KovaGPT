import { PublicPageTemplate } from "./PublicPageTemplate";
import type { PublicationFamily } from "@/content/publications";

export function PublicationIndex({ family }: { family: PublicationFamily }) {
  const label = family.replaceAll("-", " ");
  return (
    <PublicPageTemplate
      page={{
        path: `/${family}`,
        title: label.replace(/^./, (character) => character.toUpperCase()),
        description: `Verified KovaGPT ${label} publications and editorial updates.`,
        family: "publishing",
        eyebrow: "KovaGPT publications",
        summary: `There are no reviewed ${label} entries published at this time.`,
        sections: [
          {
            heading: "Nothing published yet",
            body: "KovaGPT publishes only material with verified attribution and review status. Drafts and unreviewed entries are not accessible or indexed.",
          },
          {
            heading: "Check product changes",
            body: "For confirmed product changes available today, use the KovaGPT changelog and service-status pages.",
          },
        ],
        cta: { label: "Read the changelog", href: "/changelog" },
      }}
    />
  );
}
