/** Structured, reviewable source for KovaGPT's public information architecture. */
export type PublicPage = {
  path: string;
  title: string;
  description: string;
  family: string;
  eyebrow: string;
  summary: string;
  sections: { heading: string; body: string }[];
  cta?: { label: string; href: string };
  review?: "legal" | "admin";
};

const standardSections = (subject: string) => [
  {
    heading: `A practical approach to ${subject.toLowerCase()}`,
    body: `KovaGPT brings focused tools into one workspace while keeping people in control. Availability can vary by plan, account, region, and connected provider. Review important output before using it.`,
  },
  {
    heading: "Built around your work",
    body: "Start with a clear goal, add only the context you want to share, and refine the result. KovaGPT does not promise that generated output is complete or error-free.",
  },
];

const rows: Array<[string, string, string, string, ("legal" | "admin")?]> = [
  [
    "/overview",
    "KovaGPT overview",
    "product",
    "A focused AI workspace for everyday thinking and making.",
  ],
  [
    "/features",
    "Features",
    "product",
    "Explore KovaGPT chat, files, images, projects, research, and connected tools.",
  ],
  [
    "/business",
    "KovaGPT for business",
    "product",
    "Organize team work with shared context and responsible controls.",
  ],
  [
    "/enterprise",
    "KovaGPT for enterprise",
    "product",
    "Discuss deployment, administration, and support requirements with our team.",
  ],
  [
    "/education",
    "KovaGPT for education",
    "product",
    "Tools for learning, explanation, planning, and responsible classroom use.",
  ],
  [
    "/health",
    "KovaGPT and health information",
    "product",
    "Use AI to organize questions—not to replace qualified medical care.",
  ],
  [
    "/shopping",
    "Shopping research",
    "product",
    "Compare requirements and trade-offs without sponsored rankings or invented certainty.",
  ],
  [
    "/writing",
    "Writing workspace",
    "product",
    "Draft, revise, summarize, and adapt writing while keeping your style.",
  ],
  [
    "/translate",
    "Translation assistant",
    "product",
    "Translate and explain text with context, tone, and terminology guidance.",
  ],
  [
    "/use-cases",
    "Ways to use KovaGPT",
    "use cases",
    "Find substantial workflows for study, writing, coding, research, and planning.",
  ],
  [
    "/learn",
    "Learn KovaGPT",
    "learning",
    "Practical guidance for getting useful, reviewable results.",
  ],
  ["/about", "About KovaGPT", "company", "KovaGPT is an independently developed AI workspace."],
  [
    "/mission",
    "Our mission",
    "company",
    "Make capable AI tools understandable, useful, and accountable to the people using them.",
  ],
  [
    "/company",
    "Company overview",
    "company",
    "Verified public information about KovaGPT and how to reach us.",
  ],
  [
    "/leadership",
    "Leadership",
    "company",
    "Leadership information will be published after administrator verification.",
    "admin",
  ],
  [
    "/contact",
    "Contact KovaGPT",
    "company",
    "Get product and account help at support@kovagpt.com.",
  ],
  [
    "/brand",
    "Brand resources",
    "company",
    "Guidance for referring to KovaGPT accurately and without implying endorsement.",
  ],
  [
    "/careers",
    "Careers and general interest",
    "company",
    "KovaGPT has no verified public openings listed at this time.",
  ],
  [
    "/partners",
    "Partners",
    "company",
    "Verified partner listings will appear here after administrator review.",
    "admin",
  ],
  [
    "/customers",
    "Customer use cases",
    "company",
    "Explore example workflows—not customer endorsements or testimonials.",
  ],
  [
    "/customer-stories",
    "Customer stories",
    "company",
    "No customer stories are published without explicit permission and verification.",
    "admin",
  ],
  [
    "/organizations",
    "KovaGPT for organizations",
    "company",
    "Bring structured AI assistance to repeatable organizational work.",
  ],
  [
    "/students",
    "KovaGPT for students",
    "company",
    "Learn concepts, test understanding, and cite trustworthy sources.",
  ],
  [
    "/families",
    "KovaGPT for families",
    "company",
    "Set expectations for safe, age-appropriate, supervised AI use.",
  ],
  [
    "/acceptable-use",
    "Acceptable-use policy",
    "policy",
    "Rules for responsible use of KovaGPT.",
    "legal",
  ],
  [
    "/cookie-policy",
    "Cookie policy",
    "policy",
    "Information about browser storage and cookies used by KovaGPT.",
    "legal",
  ],
  [
    "/data-processing",
    "Data processing information",
    "trust",
    "A plain-language guide to how product data moves through KovaGPT.",
    "legal",
  ],
  [
    "/family-safety",
    "Child and family safety",
    "safety",
    "Guidance for supervised and age-appropriate use.",
  ],
  [
    "/security",
    "Security",
    "trust",
    "Verified security practices and responsible ways to report concerns.",
  ],
  [
    "/responsible-disclosure",
    "Responsible disclosure",
    "trust",
    "Report a potential security issue privately and in good faith.",
  ],
  [
    "/trust",
    "Trust center",
    "trust",
    "Find KovaGPT's security, privacy, safety, and data-control resources.",
  ],
  [
    "/transparency",
    "Transparency",
    "trust",
    "How KovaGPT describes limitations, providers, and product changes without inflated claims.",
  ],
  [
    "/model-behavior",
    "Model behavior",
    "safety",
    "What influences generated responses and why answers can vary.",
  ],
  [
    "/content-moderation",
    "Content moderation",
    "safety",
    "How requests may be limited to reduce abuse and harmful output.",
  ],
  [
    "/data-controls",
    "Data controls",
    "trust",
    "Understand the account controls available for chats, files, and connected services.",
  ],
  ["/account-deletion", "Account deletion", "trust", "How to request deletion and what to expect."],
  [
    "/data-export",
    "Data export",
    "trust",
    "How to request a portable copy of eligible account data.",
  ],
  [
    "/accessibility",
    "Accessibility",
    "company",
    "Our approach to accessible product experiences and reporting barriers.",
  ],
  [
    "/copyright",
    "Copyright and IP requests",
    "policy",
    "How rights holders can contact KovaGPT about intellectual-property concerns.",
    "legal",
  ],
  [
    "/law-enforcement",
    "Law-enforcement requests",
    "policy",
    "Guidance for valid legal requests directed to KovaGPT.",
    "legal",
  ],
  [
    "/regional-notices",
    "Regional legal notices",
    "policy",
    "Region-specific notices will be published only after professional review.",
    "legal",
  ],
  [
    "/developers",
    "KovaGPT developer platform",
    "developers",
    "Build with documented KovaGPT interfaces and accountable usage controls.",
  ],
];

const developerDocs = [
  "api",
  "authentication",
  "quickstart",
  "reference",
  "models",
  "pricing",
  "rate-limits",
  "errors",
  "streaming",
  "tool-calling",
  "image-generation",
  "files",
  "safety",
  "sdks",
  "examples",
  "migrations",
  "terms",
  "policies",
];
const publications = [
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
];
const acquisitions: Array<[string, string]> = [
  ["ai-chatbot", "AI chatbot"],
  ["ai-assistant", "AI assistant"],
  ["writing-assistant", "Writing assistant"],
  ["translation", "Translation"],
  ["paraphrasing", "Paraphrasing"],
  ["summarization", "Summarization"],
  ["grammar-checker", "Grammar checking"],
  ["brainstorming", "Brainstorming"],
  ["resume-help", "Resume help"],
  ["email-writing", "Email writing"],
  ["math-help", "Math help"],
  ["document-analysis", "Document analysis"],
  ["file-analysis", "File analysis"],
  ["shopping-research", "Shopping comparison workflow"],
  ["business-assistant", "Business assistance"],
  ["education-assistant", "Education assistance"],
];

for (const slug of developerDocs)
  rows.push([
    `/developers/${slug}`,
    `Developer ${slug.replaceAll("-", " ")}`,
    "developers",
    `KovaGPT developer documentation for ${slug.replaceAll("-", " ")}.`,
    slug === "terms" || slug === "policies" ? "legal" : undefined,
  ]);
for (const slug of publications)
  rows.push([
    `/${slug}`,
    slug.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase()),
    "publishing",
    `KovaGPT ${slug.replaceAll("-", " ")} and verified technical notes.`,
  ]);
for (const [slug, title] of acquisitions)
  rows.push([
    `/use-cases/${slug}`,
    title,
    "use cases",
    `A practical KovaGPT workflow for ${title.toLowerCase()}.`,
  ]);

export const PUBLIC_PAGES: PublicPage[] = rows.map(([path, title, family, summary, review]) => ({
  path,
  title,
  family,
  eyebrow: family,
  summary,
  description: `${summary} Learn how KovaGPT supports this workflow and where human review matters.`,
  sections: standardSections(title),
  cta: { label: "Try KovaGPT", href: "/" },
  review,
}));

export const PUBLIC_PAGE_BY_PATH = new Map(PUBLIC_PAGES.map((page) => [page.path, page]));
