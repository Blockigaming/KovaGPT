export type ReviewFamily =
  "voice" | "assistant" | "media" | "team" | "legal" | "request" | "infrastructure" | "developer";
export type ReviewPage = {
  slug: string;
  title: string;
  family: ReviewFamily;
  summary: string;
  checks: string[];
};
const entry = (
  slug: string,
  title: string,
  family: ReviewFamily,
  summary: string,
  checks: string[],
): ReviewPage => ({ slug, title, family, summary, checks });
const checks: Record<ReviewFamily, string[]> = {
  voice: [
    "Microphone permission and recording indicator",
    "Stop, interrupt and text alternative",
    "Retention disclosure and accessible recovery",
  ],
  assistant: [
    "Review instructions and permitted actions",
    "Confirm audience and sharing boundaries",
    "Verify connected tools before execution",
  ],
  media: [
    "Confirm rights to source material",
    "Review prompt, dimensions and reference roles",
    "Verify output and sharing audience",
  ],
  team: [
    "Verify membership and license source",
    "Review least-privilege access",
    "Confirm retention and sharing policy with an administrator",
  ],
  legal: [
    "Obtain Kova-owned approved document",
    "Verify scope, version and effective date",
    "Obtain legal approval before publication or acceptance",
  ],
  request: [
    "Use only necessary, non-sensitive context",
    "Verify the receiving channel",
    "Review exact contents before sending",
  ],
  infrastructure: [
    "Obtain verified deployment evidence",
    "Identify accountable operator and region",
    "Approve any availability, capacity or security claim",
  ],
  developer: [
    "Verify configured API and model availability",
    "Keep credentials out of examples and downloads",
    "Review costs and permissions before execution",
  ],
};
const make = (slug: string, title: string, family: ReviewFamily, summary: string) =>
  entry(slug, title, family, summary, checks[family]);
export const REVIEW_PAGES: ReviewPage[] = [
  ...[
    ["project-diagram", "Diagram review"],
    ["project-3d", "3D model review"],
    ["project-electronics", "Electronics file review"],
    ["project-folders", "Folder upload plan"],
    ["automation-email", "Email trigger plan"],
    ["automation-financial", "Financial trigger plan"],
  ].map(([slug, title]) =>
    make(
      slug,
      title,
      "developer",
      "Prepare a local technical brief and readiness checklist. No specialized editor, folder upload, email listener, financial integration or scheduled execution is connected.",
    ),
  ),
  make(
    "voice",
    "Voice conversation",
    "voice",
    "Review a text-only call screen, voice preferences and interruption states. No microphone, audio playback or provider is connected.",
  ),
  ...[
    ["profile", "Assistant profile"],
    ["conversation", "Assistant conversation"],
    ["details", "Conversation details"],
    ["group", "Group conversation settings"],
    ["template", "Assistant template"],
    ["shared-template", "Shared template preview"],
    ["skills", "Assistant skills"],
    ["routines", "Assistant routines"],
    ["computer", "Computer view"],
    ["teach", "Teach a task"],
    ["notifications", "Assistant notifications"],
    ["shared-output", "Shared output"],
  ].map(([slug, title]) =>
    make(
      `assistant-${slug}`,
      title,
      "assistant",
      "Prepare and preview a local assistant configuration. Nothing runs, records, publishes, sends notifications or shares data.",
    ),
  ),
  ...[
    ["photo-edit", "Photo editing"],
    ["ecommerce-listing", "Product listing photography"],
    ["hero-product-reveal", "Product reveal"],
    ["living-sprite", "Character sprite"],
    ["mascot-maker", "Mascot creation"],
    ["aspect-ratio", "Image resizing"],
    ["profile-picture", "Profile image"],
    ["product-color-change", "Product recoloring"],
    ["ugc-photos", "Promotional photography"],
    ["professional-headshot", "Professional portrait"],
    ["restyle", "Image restyling"],
    ["background-removal", "Background removal"],
    ["collage", "Photo collage"],
    ["icon-maker", "Icon creation"],
    ["emoji-creator", "Emoji creation"],
    ["editorial-poster", "Editorial poster"],
    ["text-edit", "Text editing"],
    ["precise-edit", "Precise editing"],
    ["loop", "Looping video"],
    ["post", "Media post"],
    ["agent", "Media project"],
    ["references", "Reference images"],
    ["video", "Video settings"],
  ].map(([slug, title]) =>
    make(
      `media-${slug}`,
      title,
      "media",
      "Draft a media brief and preview composition settings locally. This review does not generate, edit, upload, upscale or publish media.",
    ),
  ),
  ...[
    ["workspace", "Team workspace"],
    ["licenses", "License assignment"],
    ["invitations", "Team invitations"],
    ["settings", "Team settings"],
    ["usage", "Team usage"],
    ["members", "Connector members"],
    ["sharing", "Team sharing"],
    ["retention", "Organization retention"],
  ].map(([slug, title]) =>
    make(
      `team-${slug}`,
      title,
      "team",
      "Preview an organization configuration using example labels you enter. No members, licenses, invitations, usage or organization policies are changed.",
    ),
  ),
  ...[
    ["cookie-policy", "Cookie policy review"],
    ["enterprise-faq", "Enterprise questions"],
    ["terms-of-service-enterprise", "Enterprise service terms"],
    ["startup-program-terms", "Startup program terms"],
    ["kova-bot-terms", "Persistent assistant terms"],
    ["bot-sharing-terms", "Assistant sharing terms"],
    ["x-subscription-terms-of-service", "Bundled consumer terms"],
    ["bundled-subscription-terms", "Subscription purchase and renewal terms"],
    ["x-subscription-kova-addendum", "Product subscription addendum"],
    ["x-subscription-cursor-addendum", "Companion product addendum"],
    ["europe-privacy-policy-addendum", "Regional privacy addendum"],
    ["ccpa", "Privacy transparency report"],
    ["law-enforcement", "Legal requests"],
    ["subprocessor-list", "Subprocessors"],
    ["baa", "Healthcare agreement"],
    ["data-processing-addendum", "Data processing agreement"],
    ["brand-guidelines", "Brand usage review"],
  ].map(([slug, title]) =>
    make(
      `legal-${slug}`,
      title,
      "legal",
      "No approved document for this destination is supplied in this review. Prepare a review checklist; this page is not a policy, contract or legal advice.",
    ),
  ),
  make(
    "solution-customer-support",
    "Customer support evaluation",
    "request",
    "Draft a support workflow with approved knowledge sources, escalation rules and human review before customer-facing messages.",
  ),
  make(
    "solution-legal",
    "Legal-work evaluation",
    "request",
    "Prepare source review and confidentiality requirements. AI output does not replace qualified legal advice or authorize filing or agreement.",
  ),
  make(
    "solution-security",
    "Security-work evaluation",
    "request",
    "Scope authorized defensive analysis, data boundaries and human approval. No scanning, system access or security changes occur.",
  ),
  make(
    "privacy-request",
    "Privacy request preparation",
    "request",
    "Prepare a local request outline. No identity verification, account deletion or request submission occurs.",
  ),
  make(
    "sales-request",
    "Sales inquiry preparation",
    "request",
    "Prepare requirements locally without implying an offer, team entitlement or sales submission.",
  ),
  make(
    "infrastructure",
    "Infrastructure evidence",
    "infrastructure",
    "Review the evidence needed for infrastructure claims. Capacity, locations, uptime and certifications are not asserted.",
  ),
  make(
    "api-imagine",
    "Media API planning",
    "developer",
    "Review an integration brief. No media API, model availability or pricing is implied.",
  ),
  make(
    "government",
    "Government evaluation",
    "request",
    "Prepare deployment questions without claiming a government offering, authorization or contract.",
  ),
];
export const REVIEW_PAGE_BY_SLUG = new Map(REVIEW_PAGES.map((page) => [page.slug, page]));
export const PUBLIC_REVIEW_ALIASES: Record<string, string> = {
  colossus: "infrastructure",
  infrastructure: "infrastructure",
  "privacy-portal": "privacy-request",
  "solutions/customer-support": "solution-customer-support",
  "solutions/legal": "solution-legal",
  "solutions/security": "solution-security",
  "legal/faq-enterprise": "legal-enterprise-faq",
  "legal/assistant-terms": "legal-kova-bot-terms",
  "legal/bundled-subscription": "legal-bundled-subscription-terms",
  ...Object.fromEntries(
    REVIEW_PAGES.filter(
      (p) =>
        p.family === "legal" && !["legal-cookie-policy", "legal-brand-guidelines"].includes(p.slug),
    ).map((p) => [`legal/${p.slug.slice(6)}`, p.slug]),
  ),
  ...Object.fromEntries(
    REVIEW_PAGES.filter((p) => p.family === "media").map((p) => [
      `imagine/template/imagine-${p.slug.slice(6)}`,
      p.slug,
    ]),
  ),
};
export function findReviewPage(path: string) {
  const slug = path.startsWith("review/") ? path.slice(7) : PUBLIC_REVIEW_ALIASES[path];
  return slug ? REVIEW_PAGE_BY_SLUG.get(slug) : undefined;
}
