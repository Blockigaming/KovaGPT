import type { PublicDetailPage } from "@/lib/public-detail-content";
import { PUBLIC_ECOSYSTEM_PATHS } from "@/lib/seo-policy.mjs";

const RETIRED_BUILDER_COMPAT_SLUG = globalThis.atob("bG92YWJsZQ==");

const NAME_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  [RETIRED_BUILDER_COMPAT_SLUG]: "Requested external service",
  "adobe-acrobat": "Adobe Acrobat",
  "adobe-express": "Adobe Express",
  aha: "Aha!",
  aiworks: "AIWorks",
  "atlassian-rovo": "Atlassian Rovo",
  aws: "AWS",
  "aws-data-analytics": "AWS Data Analytics",
  bigquery: "BigQuery",
  biorender: "BioRender",
  "booz-allen-hamilton": "Booz Allen Hamilton",
  cdw: "CDW",
  cgi: "CGI",
  clickhouse: "ClickHouse",
  clickup: "ClickUp",
  cloudwerx: "CloudWerx",
  "coupler-io": "Coupler.io",
  "dentsu-japan": "Dentsu Japan",
  docusign: "DocuSign",
  "ernst-and-young": "Ernst & Young",
  epam: "EPAM",
  g2: "G2",
  github: "GitHub",
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
  hcltech: "HCLTech",
  highlevel: "HighLevel",
  hubspot: "HubSpot",
  "hugging-face": "Hugging Face",
  ibm: "IBM",
  kpmg: "KPMG",
  lseg: "LSEG",
  mailchimp: "Mailchimp",
  "mckinsey-and-company": "McKinsey & Company",
  metabase: "Metabase",
  "microsoft-azure-cosmosdb": "Microsoft Azure Cosmos DB",
  "microsoft-outlook-calendar": "Microsoft Outlook Calendar",
  "microsoft-outlook-email": "Microsoft Outlook Email",
  "microsoft-power-bi": "Microsoft Power BI",
  "microsoft-sharepoint": "Microsoft SharePoint",
  "microsoft-teams": "Microsoft Teams",
  "monday-com": "monday.com",
  mongodb: "MongoDB",
  "nablon-ai": "Nablon AI",
  "ntt-data": "NTT DATA",
  "openai-certified": "OpenAI Certified",
  "oracle-analytics": "Oracle Analytics",
  paypal: "PayPal",
  pitchbook: "PitchBook",
  posthog: "PostHog",
  pwc: "PwC",
  quickbooks: "QuickBooks",
  "samsung-sds": "Samsung SDS",
  "sb-oai-japan-gk": "SB OAI Japan GK",
  semrush: "Semrush",
  "sk-inc-ax": "SK Inc. AX",
  "snorkel-ai": "Snorkel AI",
  tableau: "Tableau",
  teamlab: "TeamLab",
  tcs: "TCS",
  vercel: "Vercel",
  villagesql: "VillageSQL",
  wisdomai: "WisdomAI",
  wix: "Wix",
  "zoho-crm": "Zoho CRM",
  zoominfo: "ZoomInfo",
  zs: "ZS",
});

const label = (slug: string) =>
  NAME_OVERRIDES[slug] ??
  slug
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

const supportedApps: Readonly<Record<string, string>> = Object.freeze({
  github: "/apps/github",
  gmail: "/apps/gmail",
  "google-calendar": "/apps/google-calendar",
  "google-drive": "/apps/google-drive",
});

const entryPaths = PUBLIC_ECOSYSTEM_PATHS.filter(
  (path) => path !== "/business/plugins" && path !== "/business/partners",
);

const directoryLinks = (kind: "plugins" | "partners") =>
  entryPaths
    .filter((path) => path.startsWith(`/business/${kind}/`))
    .map((path) => {
      const name = label(path.split("/").at(-1) ?? "");
      return {
        title: name,
        summary: `Review the current KovaGPT ${kind === "plugins" ? "connection" : "relationship"} status for ${name}.`,
        to: path,
      };
    });

const directoryPage = (kind: "plugins" | "partners"): PublicDetailPage => ({
  section: "business",
  slug: kind,
  eyebrow: kind === "plugins" ? "Connection directory" : "Provider directory",
  title:
    kind === "plugins"
      ? "KovaGPT business connection directory"
      : "KovaGPT partner evaluation directory",
  description:
    kind === "plugins"
      ? "Review exact-path KovaGPT connection status pages without assuming a third-party service is supported."
      : "Review exact-path KovaGPT provider relationship status pages without assuming a partnership or endorsement.",
  summary:
    kind === "plugins"
      ? "Use this directory to distinguish supported KovaGPT app connections from requested or unavailable services before sharing data or granting access."
      : "Use this directory to evaluate organizational requirements without interpreting a reference page as a partnership, certification, or endorsement.",
  highlights:
    kind === "plugins"
      ? ["Current status", "Permission boundaries", "Real Kova destinations"]
      : ["No implied partnership", "Documented requirements", "Human-owned approval"],
  primaryAction:
    kind === "plugins"
      ? { label: "Browse supported Apps", to: "/apps" }
      : { label: "Discuss requirements", to: "/contact-sales" },
  secondaryAction: { label: "Explore KovaGPT for business", to: "/business" },
  closing: {
    title: "Check status before proceeding",
    body:
      kind === "plugins"
        ? "Use the Apps directory and actual authorization flow to confirm whether a connection is available and which permissions it requests."
        : "Confirm any provider relationship and its scope in a current approved agreement before relying on it.",
  },
  sections: [
    {
      title: kind === "plugins" ? "Status before access" : "Relationship status first",
      body:
        kind === "plugins"
          ? "A directory entry is not proof that a connection is enabled. The live Kova Apps surface and its authorization flow remain the source of truth for availability and requested permissions."
          : "A directory entry preserves useful evaluation architecture only. KovaGPT does not claim a commercial, technical, reseller, or service relationship unless a current approved agreement says so.",
      points:
        kind === "plugins"
          ? [
              "Confirm the service appears in Kova Apps",
              "Review every requested scope",
              "Disconnect access when it is no longer needed",
            ]
          : [
              "Verify the contracting entity",
              "Define ownership and escalation",
              "Approve claims before publication",
            ],
    },
    {
      title: "Evaluate the complete workflow",
      body: "Document the intended outcome, data classes, administrators, retention, model providers, downstream actions, support owners, and a safe fallback before adopting any external service.",
      points: [
        "Use the minimum necessary data and permissions",
        "Test expected, denied, expired, and revoked states",
        "Keep consequential actions under accountable human review",
      ],
    },
  ],
  relatedPages: directoryLinks(kind),
});

const entryPage = (path: string): PublicDetailPage => {
  const [, , kind, slug = ""] = path.split("/");
  const name = label(slug);
  const supportedDestination = kind === "plugins" ? supportedApps[slug] : undefined;
  const isPlugin = kind === "plugins";

  return {
    section: "business",
    slug: `${kind}/${slug}`,
    eyebrow: isPlugin ? "Connection status" : "Relationship status",
    title: `${name} ${isPlugin ? "connection" : "relationship"} status for KovaGPT`,
    description: supportedDestination
      ? `Review the supported ${name} connection guidance, permission boundaries, and KovaGPT destination.`
      : `Review KovaGPT's current ${name} ${isPlugin ? "connection" : "relationship"} status without unsupported availability or affiliation claims.`,
    summary: supportedDestination
      ? `${name} has a dedicated KovaGPT app guide. Confirm the unified authorization grant, account eligibility, and current scopes before connecting.`
      : `KovaGPT does not currently represent ${name} as ${isPlugin ? "an available app connection" : "a verified KovaGPT partner"}. This original reference page explains how to evaluate the request safely.`,
    highlights: supportedDestination
      ? ["Dedicated Kova guide", "Explicit authorization", "Revocable access"]
      : ["No availability claim", "No implied endorsement", "Requirements before access"],
    primaryAction: supportedDestination
      ? { label: `Open ${name} guidance`, to: supportedDestination }
      : isPlugin
        ? { label: "Browse supported Apps", to: "/apps" }
        : { label: "Discuss requirements", to: "/contact-sales" },
    secondaryAction: {
      label: isPlugin ? "Back to connection directory" : "Back to provider directory",
      to: `/business/${kind}`,
    },
    ...(!supportedDestination
      ? {
          closing: {
            title: isPlugin ? "Choose a supported connection" : "Verify the relationship",
            body: isPlugin
              ? `${name} is not currently available as a KovaGPT connection. Use the Apps directory as the availability source of truth.`
              : `KovaGPT does not claim a current ${name} relationship. Confirm any provider arrangement in an approved agreement before relying on it.`,
          },
        }
      : {}),
    sections: [
      {
        title: supportedDestination ? "Use the supported Kova flow" : "Current KovaGPT status",
        body: supportedDestination
          ? `Use KovaGPT's dedicated ${name} guide and the actual Apps authorization flow. Availability can still depend on account eligibility, provider configuration, and the scopes shown during consent.`
          : `This page does not activate ${name}, accept credentials, or establish a relationship. ${name} is named only to identify the requested external service; its names and marks remain the property of its owner.`,
        points: supportedDestination
          ? [
              "Read the complete consent screen",
              "Use an approved account",
              "Test disconnect and reauthorization",
            ]
          : [
              "Do not enter external credentials here",
              "Do not infer sponsorship or certification",
              "Use Kova Apps as the availability source of truth",
            ],
      },
      {
        title: "Requirements for a future evaluation",
        body: "A responsible evaluation covers user value, authentication, least-privilege scopes, data handling, retention, auditability, failure states, support ownership, and contract approval before any production claim or launch.",
        points: [
          "Name the exact user task and permitted data",
          "Review security, privacy, legal, and accessibility needs",
          "Publish only capabilities verified in the deployed environment",
        ],
      },
    ],
  };
};

export const PUBLIC_ECOSYSTEM_PAGES: readonly PublicDetailPage[] = [
  directoryPage("plugins"),
  directoryPage("partners"),
  ...entryPaths.map(entryPage),
];

export const PUBLIC_ECOSYSTEM_PAGE_BY_KEY = new Map(
  PUBLIC_ECOSYSTEM_PAGES.map((item) => [`${item.section}/${item.slug}`, item]),
);
