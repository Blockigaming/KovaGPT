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
    section: "news",
    slug: "argon",
    title: "Inside Argon: from question to clarity",
    description: "Meet Argon in KovaGPT.",
    publishedAt: "2026-11-13",
    body: [
      "Argon is part of the KovaGPT model lineup. Use the model options available to your account to start a conversation, refine an explanation, or work through a draft.",
      "For a useful comparison, try the same task with the models available to you. Review the accuracy of each answer, its clarity, and how well it follows your instructions.",
      "Model availability and usage allowances depend on your plan. Consult the current model catalog and your account settings for the options enabled for you.",
    ],
  },
  {
    section: "news",
    slug: "neon",
    title: "Meet Neon. Explore another way to think.",
    description: "Explore Neon in the KovaGPT model lineup.",
    publishedAt: "2026-11-13",
    body: [
      "Neon is a KovaGPT model option. Give it a specific goal, relevant context, and a description of what a useful result should contain.",
      "Build on the first response: ask for another example, a clearer explanation, or a different structure. Review important details before relying on the result.",
      "The model selector and developer catalog show current availability. This overview does not announce new benchmark results or change your plan allowances.",
    ],
  },
  {
    section: "news",
    slug: "interactive-workspace",
    title: "KovaGPT is moving beyond the chat box",
    description: "Explore conversations, projects, and tools in one workspace.",
    publishedAt: "2026-11-13",
    body: [
      "KovaGPT brings conversations, projects, and tools together so related work can stay in context.",
      "Use Projects to organize an ongoing task. Explore the feature guides for images, voice, code, and files to understand requirements and limitations.",
      "Interactive responses help turn an answer into a next step. Available controls depend on the response, enabled tools, and your account.",
    ],
  },
  {
    section: "news",
    slug: "developer-platform",
    title: "Your next app could start with KovaGPT",
    description: "Explore the KovaGPT developer platform.",
    publishedAt: "2026-11-13",
    body: [
      "The developer platform provides scoped credentials, a model catalog, and spending controls. Check your console for access and funding availability before executing paid work.",
      "Start with a read-only request to /api/v1/models using your developer bearer key. Keep credentials on your server and out of browser code.",
      "The quickstart describes the quote flow for paid operations. Use the same input when submitting the quoted operation and retain a stable idempotency key when retrying.",
    ],
  },
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
