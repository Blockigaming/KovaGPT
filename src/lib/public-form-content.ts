import type { PublicDetailPage } from "@/lib/public-detail-content";
import { PUBLIC_FORM_PATHS } from "@/lib/seo-policy.mjs";

const TITLES: Readonly<Record<string, string>> = Object.freeze({
  "100-chats-book-request": "Conversation collection request status",
  "aardvark-beta-signup": "Beta access request status",
  "au-osa-compliance": "Australia online-safety contact status",
  "business/premium-offer": "Business premium offer status",
  "chat-model-feedback": "Chat model feedback options",
  "chatgpt-pro-community": "Pro community request status",
  "codex-enterprise-promo": "Enterprise coding promotion status",
  "codex-for-oss": "Open-source coding support status",
  "codex-labs": "Coding labs request status",
  "codex-open-source-fund": "Open-source fund request status",
  "codex-project-showcase-and-feedback": "Coding project showcase status",
  "copyright-disputes": "Copyright dispute support options",
  "cybersecurity-grant-program": "Cybersecurity grant request status",
  "data-partnerships": "Data partnership request status",
  "daybreak-cyber-partner-program": "Cyber partner program status",
  "economic-research-exchange": "Economic research exchange status",
  "enterprise-trusted-access-for-cyber": "Enterprise cyber access status",
  "eu-ai-act": "EU AI Act contact status",
  "feature-gpt": "Assistant feature request status",
  "gdpval-customer-contribution": "Work-evaluation contribution status",
  "gpt-live-1-in-the-api": "Live API interest status",
  "guaranteed-capacity": "Guaranteed capacity request status",
  "hackathon-support": "Hackathon support request status",
  "learning-lab": "Learning lab request status",
  "mcp-connector-interest-form": "Tool connector interest status",
  "model-behavior-feedback": "Model behavior feedback options",
  "model-spec-feedback": "Model specification feedback options",
  "model-withdrawal": "Model withdrawal request status",
  "openai-for-government": "Government service request status",
  "openai-on-aws": "Cloud deployment request status",
  "real-world-knowledge-work": "Knowledge-work research request status",
  "report-content": "Content report support options",
  "researcher-access-program": "Researcher access request status",
  "rosalind-biodefense-program": "Biodefense research program status",
  "share-your-story": "Customer story submission status",
  "showcase-submission": "Project showcase submission status",
  "stargate-infrastructure": "Infrastructure request status",
  "subscribe-to-new-sub-processors": "Subprocessor update options",
  "trademark-counterfeit-disputes": "Trademark dispute support options",
  "uk-osa-compliance": "UK online-safety contact status",
  ultrafast: "High-speed model interest status",
  "usage-policy-update": "Usage-policy update options",
  "vc-partnerships-application": "Investor partnership request status",
});

const policyPath =
  /(?:compliance|copyright|eu-ai-act|online-safety|sub-processors|trademark|usage-policy)/u;
const salesPath =
  /(?:business|capacity|data-partnerships|enterprise|government|infrastructure|investor|openai-on-aws|vc-partnerships)/u;

const primaryActionFor = (path: string): PublicDetailPage["primaryAction"] => {
  if (policyPath.test(path)) return { label: "Review KovaGPT policies", to: "/policies" };
  if (salesPath.test(path))
    return { label: "Discuss organization requirements", to: "/contact-sales" };
  return { label: "Contact KovaGPT support", to: "/contact-support" };
};

const formPage = (path: string): PublicDetailPage => {
  const slug = path.slice("/form/".length);
  const title = TITLES[slug];
  if (!title) throw new Error(`Missing public form title for ${path}`);

  return {
    section: "form",
    slug,
    eyebrow: "Request route status",
    title,
    description: `${title} at KovaGPT, with clear data-collection boundaries and verified support, policy, or sales destinations.`,
    summary: `KovaGPT does not host the external intake form formerly associated with this address. This status page explains the boundary and provides safe KovaGPT destinations without presenting the program as available.`,
    highlights: ["No intake form", "No sensitive data collected", "Verified KovaGPT destinations"],
    primaryAction: primaryActionFor(path),
    secondaryAction: { label: "Return to KovaGPT", to: "/" },
    sections: [
      {
        title: "What this route does not collect",
        body: `The ${title.toLowerCase()} page does not accept contact details, account credentials, documents, legal notices, payment information, confidential material, or application responses. KovaGPT does not claim that the corresponding external program, promotion, grant, community, research activity, or offer is available through KovaGPT.`,
        points: [
          "Do not submit credentials or private documents through this route",
          "No application, registration, payment, or legal notice is created here",
          "No affiliation, availability, selection, or response is implied",
        ],
      },
      {
        title: "Choose a verified KovaGPT next step",
        body: "Use KovaGPT's published policy pages for current rules, contact Sales to discuss an organization requirement, or contact Support for product and account help. Before sending information, verify the destination, share only what is necessary, and avoid secrets or regulated data unless an approved channel and written requirements explicitly allow it.",
        points: [
          "Use Policies for published terms, privacy, safety, and usage guidance",
          "Use Sales for documented organization, capacity, or deployment requirements",
          "Use Support for product questions, feedback, reports, and account help",
        ],
      },
    ],
  };
};

export const PUBLIC_FORM_PAGES: readonly PublicDetailPage[] = PUBLIC_FORM_PATHS.map(formPage);

export const PUBLIC_FORM_PAGE_BY_KEY = new Map(
  PUBLIC_FORM_PAGES.map((page) => [`${page.section}/${page.slug}`, page]),
);
