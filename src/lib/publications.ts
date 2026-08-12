export type Publication = {
  section: string;
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  body: string[];
};
export const PUBLICATION_SECTIONS = [
  "news",
  "product-updates",
  "engineering",
  "research",
  "safety-reports",
  "stories",
  "videos",
  "guides",
  "release-notes",
] as const;
export const PUBLICATIONS: readonly Publication[] = [
  {
    section: "product-updates",
    slug: "workspace-foundations",
    title: "A clearer foundation for the KovaGPT workspace",
    description:
      "How shared navigation and truthful capability states make KovaGPT easier to understand.",
    publishedAt: "2026-08-11",
    body: [
      "We consolidated public navigation around capabilities that have a real product or documented preview state.",
      "Provider-dependent experiences remain clearly gated. This update does not change Azure, authentication, billing, or private-data enforcement.",
    ],
  },
  {
    section: "engineering",
    slug: "server-owned-capabilities",
    title: "Why capabilities belong on the server",
    description: "A practical overview of server-side entitlement and provider boundaries.",
    publishedAt: "2026-08-11",
    body: [
      "A client-side switch is not authorization. KovaGPT evaluates authenticated ownership, plan entitlement, provider configuration, and request limits on trusted server paths.",
      "Public documentation describes these principles without publishing secrets or internal operational data.",
    ],
  },
  {
    section: "safety-reports",
    slug: "truthful-preview-states",
    title: "Designing truthful preview states",
    description: "How KovaGPT communicates unavailable provider-backed functionality.",
    publishedAt: "2026-08-11",
    body: [
      "A convincing mock control can mislead users into believing their data is being processed or protected in a particular way.",
      "KovaGPT uses explicit decision gates for experiences such as Maps and Voice until product, privacy, and infrastructure requirements are approved.",
    ],
  },
];
export const publicationKey = (section: string, slug: string) => `${section}/${slug}`;
export const PUBLICATION_BY_KEY = new Map(
  PUBLICATIONS.map((item) => [publicationKey(item.section, item.slug), item]),
);
