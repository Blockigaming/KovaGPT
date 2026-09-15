import type { PublicDetailPage } from "@/lib/public-detail-content";
import { PUBLIC_BUSINESS_PATHS } from "@/lib/seo-policy.mjs";

const TITLE_OVERRIDES = new Map<string, string>([
  ["amex-chatgpt-business-credit", "Business credit program availability"],
  ["customer-stories", "KovaGPT business examples"],
  ["fine-tuning-gpt-4o-webinar", "Fine-tuning evaluation session"],
  ["frontier", "KovaGPT for complex organization workflows"],
  ["guaranteed-capacity", "Capacity planning for KovaGPT"],
  ["chatgpt-business-smb-guide", "KovaGPT guide for small and midsize businesses"],
  ["chatgpt-usage-and-adoption-patterns-at-work", "AI adoption patterns at work"],
  ["how-openai-uses-codex", "How teams use coding agents"],
  ["inside-gpt5-our-best-model-for-work", "Choosing an AI mode for work"],
  ["the-state-of-enterprise-ai-2025-report", "Enterprise AI readiness guide"],
  ["download-the-chatgpt-work-guide-for-sales-teams", "AI work guide for sales teams"],
  ["gartner-2026-agentic-coding-leader", "Independent analyst recognition status"],
  ["how-our-sales-team-uses-chatgpt-work", "How sales teams can use KovaGPT"],
  ["new-in-chatgpt-for-business-april-updates-2025", "KovaGPT business update status"],
  ["new-in-chatgpt-for-work-march-updates-2025", "KovaGPT work update status"],
  ["openai-presence", "KovaGPT service availability"],
  [
    "solving-complex-problems-with-openai-o1-models",
    "Solving complex problems with reasoning modes",
  ],
  ["updates-to-chatgpt-business-plans-livestream-june-2025", "KovaGPT plan update status"],
]);

const titleFromPath = (path: string) => {
  const slug = path.split("/").at(-1) ?? "business";
  const override = TITLE_OVERRIDES.get(slug);
  if (override) return override;
  const value = slug
    .replaceAll("-", " ")
    .replace(/\bchatgpt\b/giu, "KovaGPT")
    .replace(/\bopenai\b/giu, "KovaGPT")
    .replace(/\bgpt ?4o\b/giu, "advanced AI")
    .replace(/\bgpt ?5\b/giu, "advanced AI")
    .replace(/\bo1\b/giu, "reasoning")
    .replace(/\bsmb\b/giu, "SMB")
    .replace(/\bai\b/giu, "AI");
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
};

const isStatusOnly = (path: string) =>
  /(?:credit|customer-stories|webinar|frontier|guaranteed-capacity|gartner|new-in-|presence|livestream|state-of-enterprise-ai-2025)/u.test(
    path,
  );

const actionFor = (path: string): PublicDetailPage["primaryAction"] => {
  if (path.endsWith("/pricing")) return { label: "Compare KovaGPT plans", to: "/pricing" };
  if (path.includes("contact-sales") || path.includes("financial-services"))
    return { label: "Discuss organization requirements", to: "/contact-sales" };
  if (path.includes("/solutions/") || path.includes("why-openai"))
    return { label: "Explore KovaGPT for business", to: "/business" };
  if (path.endsWith("/workspace-agents")) return { label: "Open KovaGPT Work", to: "/work" };
  if (path.endsWith("/model")) return { label: "Review available AI modes", to: "/modes" };
  return { label: "Explore KovaGPT for business", to: "/business" };
};

const businessPage = (path: string): PublicDetailPage => {
  const slug = path.slice("/business/".length);
  const title = titleFromPath(path);
  const statusOnly = isStatusOnly(path);
  const primaryAction = actionFor(path);
  return {
    section: "business",
    slug,
    eyebrow: statusOnly ? "KovaGPT business availability" : "KovaGPT business guide",
    title,
    description: statusOnly
      ? `Current KovaGPT status for ${title.toLowerCase()}, without unsupported partnership, event, capacity, award, or customer claims.`
      : `Original KovaGPT guidance for ${title.toLowerCase()}, with scoped inputs, accountable review, and deployment checks.`,
    summary: statusOnly
      ? `This exact-path KovaGPT page records what is and is not currently published for ${title.toLowerCase()}. It does not import another company’s announcement, event, customer story, commercial offer, or recognition.`
      : `Use this KovaGPT guide to turn ${title.toLowerCase()} into a bounded organization workflow with approved context, measurable outcomes, and people responsible for the final decision.`,
    highlights: statusOnly
      ? ["No unsupported claim", "Current KovaGPT routes", "Requirements verified directly"]
      : ["Scoped workflow", "Approved information", "Accountable review"],
    primaryAction,
    secondaryAction: { label: "KovaGPT business overview", to: "/business" },
    ...(statusOnly
      ? {
          closing: {
            title: "Verify the current offering",
            body: "This status page does not publish the referenced offer, event, relationship, capacity, or recognition. Confirm current KovaGPT capabilities and written commitments before relying on them.",
          },
        }
      : {}),
    sections: statusOnly
      ? [
          {
            title: "Current KovaGPT status",
            body: `KovaGPT does not currently publish the external program or claim associated with “${title}.” No partnership, customer deployment, analyst recognition, guaranteed capacity, promotion, webinar attendance, or dated product announcement should be inferred from this compatibility route.`,
            points: [
              "No registration, redemption, or application is collected here",
              "No third-party relationship or endorsement is implied",
              "Only current KovaGPT product and policy pages describe availability",
            ],
          },
          {
            title: "Verify a real organization requirement",
            body: "Start with the intended workflow, users, data classes, access model, volume, review process, and consequences of error. Product, capacity, security, privacy, support, billing, and contractual requirements must be confirmed against the configured KovaGPT environment and any written agreement before deployment.",
            points: [
              "Use published KovaGPT plan and capability information",
              "Request written confirmation for contractual requirements",
              "Keep a human owner for rollout and incident decisions",
            ],
          },
        ]
      : [
          {
            title: `Plan ${title.toLowerCase()}`,
            body: `Define the outcome, audience, responsible owner, approved inputs, excluded data, and review checkpoints before using KovaGPT for ${title.toLowerCase()}. Begin with a small representative workflow whose quality and failure modes can be observed.`,
            points: [
              "Separate source evidence from generated suggestions",
              "Define measurable quality, time, and risk criteria",
              "Test expected, ambiguous, and adverse cases",
            ],
          },
          {
            title: "Move from pilot to dependable practice",
            body: "Confirm identity, permissions, retention, provider availability, cost, accessibility, monitoring, and recovery for the real environment. Generated output remains a draft until important facts, calculations, sources, and consequential decisions are reviewed by an accountable person.",
            points: [
              "Document who can use each source and action",
              "Create escalation and rollback paths",
              "Review outcomes and retire ineffective workflows",
            ],
          },
        ],
  };
};

export const PUBLIC_BUSINESS_PAGES: readonly PublicDetailPage[] =
  PUBLIC_BUSINESS_PATHS.map(businessPage);

export const PUBLIC_BUSINESS_PAGE_BY_KEY = new Map(
  PUBLIC_BUSINESS_PAGES.map((page) => [`${page.section}/${page.slug}`, page]),
);
