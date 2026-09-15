import type { PublicDetailPage } from "@/lib/public-detail-content";
import { PUBLIC_POLICY_PATHS } from "@/lib/seo-policy.mjs";

const TITLE_OVERRIDES = new Map<string, string>([
  ["ad-tools-dpa", "Advertising tools data processing addendum"],
  ["au-online-safety-act", "Australia online safety information"],
  ["br-privacy-policy", "Brazil privacy information"],
  ["brazil-eca-digital", "Brazil digital child-safety information"],
  ["chatgpt-sites-data-processing-addendum", "Sites data processing addendum"],
  ["chatgpt-sites-terms", "Sites terms"],
  ["dec-2024-eu-terms", "December 2024 European terms"],
  ["eu-services-privacy-policy", "European services privacy information"],
  ["feb-2024-data-processing-addendum", "February 2024 data processing addendum"],
  ["how-chatgpt-and-our-foundation-models-are-developed", "How KovaGPT AI services are assembled"],
  ["jun-2023-privacy-policy", "June 2023 privacy policy archive"],
  ["kr-privacy-policy", "Korea privacy information"],
  ["oct-2024-eu-terms", "October 2024 European terms"],
  ["oct-2024-row-terms", "October 2024 rest-of-world terms"],
  ["openai-cve-assignment-policy", "CVE assignment policy status"],
  ["row-terms-of-use", "Rest-of-world terms of use"],
  ["supplier-dpa", "Supplier data processing addendum"],
  ["uk-online-safety-act", "United Kingdom online safety information"],
  ["uk-tax-strategy", "United Kingdom tax strategy status"],
  ["unauthorized-openai-equity-transactions", "Unauthorized equity transaction notice"],
  ["us-privacy-policy", "United States privacy information"],
  ["using-chatgpt-agent-in-line-with-our-policies", "Using KovaGPT agents within policy"],
]);

const titleFromSlug = (slug: string) => {
  const override = TITLE_OVERRIDES.get(slug);
  if (override) return override;
  const value = slug
    .replaceAll("-", " ")
    .replace(/\bdpa\b/giu, "DPA")
    .replace(/\bcve\b/giu, "CVE")
    .replace(/\beu\b/giu, "EU")
    .replace(/\bau\b/giu, "Australia")
    .replace(/\bbr\b/giu, "Brazil")
    .replace(/\bkr\b/giu, "Korea")
    .replace(/\buk\b/giu, "United Kingdom")
    .replace(/\bus\b/giu, "United States")
    .replace(/\brow\b/giu, "rest-of-world");
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
};

const destinationFor = (slug: string): PublicDetailPage["primaryAction"] => {
  if (/(?:privacy|cookie|communications|data-is-used|foundation-models-are-developed)/u.test(slug))
    return { label: "Read KovaGPT privacy information", to: "/privacy" };
  if (/(?:usage-policies|online-safety|agent-in-line|commerce-policies)/u.test(slug))
    return { label: "Read KovaGPT safety guidance", to: "/ai-safety" };
  if (/(?:vulnerability|cve|security-measures|cybersecurity)/u.test(slug))
    return { label: "Review KovaGPT security", to: "/security" };
  if (/(?:data-processing|sub-processor|subprocessors|supplier-dpa)/u.test(slug))
    return { label: "Discuss organization requirements", to: "/contact-sales" };
  if (/(?:terms|agreement|service-credit|supplier-code|tax-strategy|equity)/u.test(slug))
    return { label: "Read current KovaGPT terms", to: "/terms" };
  return { label: "Browse KovaGPT policies", to: "/policies" };
};

const policyPage = (path: string): PublicDetailPage => {
  const slug = path.slice("/policies/".length);
  const title = titleFromSlug(slug.split("/").at(-1) ?? slug);
  const primaryAction = destinationFor(slug);
  return {
    section: "policies",
    slug,
    eyebrow: "KovaGPT policy reference",
    title,
    description: `KovaGPT reference for ${title.toLowerCase()}, with the current applicable KovaGPT destination and a clear non-adoption notice.`,
    summary: `Use this compatibility route to find how KovaGPT addresses the subject associated with ${title.toLowerCase()}. It is a navigation and status reference, not a standalone contract or policy edition.`,
    highlights: [
      "KovaGPT-specific guidance",
      "No imported third-party terms",
      "Current documents take priority",
    ],
    primaryAction,
    secondaryAction: { label: "Policy center", to: "/policies" },
    closing: {
      title: "Confirm the current document",
      body: "This compatibility route is not a standalone KovaGPT policy or agreement. Use the linked current document and any applicable signed agreement before relying on terms or obligations.",
    },
    sections: [
      {
        title: `Status of ${title.toLowerCase()}`,
        body: `KovaGPT has not published a separate agreement under the title “${title}” at this compatibility path. This page does not reproduce, adopt, replace, or summarize another organization’s document. Only a currently published KovaGPT policy and any written agreement signed by the relevant parties can define KovaGPT obligations.`,
        points: [
          `Do not treat “${title}” as accepted KovaGPT terms`,
          "Use the linked KovaGPT destination for current information",
          "Keep a copy of the document and effective date you actually rely on",
        ],
      },
      {
        title: "Confirm the controlling document",
        body: `Requirements vary by product, account, organization, location, and configured service. Before relying on this subject for procurement, compliance, privacy, security, advertising, or another consequential decision, verify the current KovaGPT document, the exact service in scope, and any signed agreement. Contact the appropriate KovaGPT channel when the published material does not answer the question.`,
        points: [
          "Check that the document names KovaGPT and the service you use",
          "Resolve conflicts in favor of the signed agreement and current notice",
          "Seek qualified legal or compliance advice for your circumstances",
        ],
      },
    ],
  };
};

export const PUBLIC_POLICY_PAGES: readonly PublicDetailPage[] = PUBLIC_POLICY_PATHS.map(policyPage);

export const PUBLIC_POLICY_PAGE_BY_KEY = new Map(
  PUBLIC_POLICY_PAGES.map((page) => [`${page.section}/${page.slug}`, page]),
);
