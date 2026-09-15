import type { PublicDetailPage } from "@/lib/public-detail-content";

type SolutionCategory = "blueprints" | "industries" | "use-case";

const categoryLabels: Record<SolutionCategory, string> = {
  blueprints: "Blueprint",
  industries: "Industry workflow",
  "use-case": "Use case",
};

const solution = (
  category: SolutionCategory,
  slug: string,
  title: string,
  description: string,
  summary: string,
  highlights: readonly string[],
  first: Readonly<{ title: string; body: string; points: readonly string[] }>,
  second: Readonly<{ title: string; body: string; points: readonly string[] }>,
  primaryAction: PublicDetailPage["primaryAction"] = {
    label: "Start in KovaGPT",
    to: "/",
  },
): PublicDetailPage => ({
  section: "solutions",
  slug: `${category}/${slug}`,
  eyebrow: categoryLabels[category],
  title,
  description,
  summary,
  highlights,
  sections: [first, second],
  primaryAction,
  secondaryAction: { label: "Explore all solutions", to: "/solutions" },
});

export const PUBLIC_SOLUTION_PAGES: readonly PublicDetailPage[] = [
  solution(
    "blueprints",
    "knowledge-retrieval",
    "Knowledge retrieval with KovaGPT",
    "Design a permission-aware KovaGPT knowledge-retrieval workflow with source checks and human review.",
    "Turn approved files and connected sources into answers people can inspect, while preserving access boundaries and making uncertainty visible.",
    ["Permission-aware sources", "Reviewable answers", "Human-owned decisions"],
    {
      title: "Ground answers in approved context",
      body: "Define which repositories, files, and connected services are allowed before retrieval begins. Keep source identity and freshness visible so a fluent answer never substitutes for evidence.",
      points: [
        "Limit retrieval to authorized sources",
        "Keep citations close to important claims",
        "Show when relevant evidence is missing",
      ],
    },
    {
      title: "Evaluate the complete workflow",
      body: "Test permission changes, stale documents, conflicting sources, empty results, and provider failures. A production workflow needs predictable fallbacks and an accountable reviewer.",
      points: [
        "Test revocation and access changes",
        "Measure answer quality against a reviewed set",
        "Escalate high-impact decisions to a person",
      ],
    },
    { label: "Open Files", to: "/files" },
  ),
  solution(
    "blueprints",
    "mcpkit",
    "Build a bounded MCP integration",
    "Plan a KovaGPT MCP integration with explicit tools, authorization, confirmations, and failure handling.",
    "Connect a service through the Model Context Protocol only after its actions, scopes, user intent, and operational boundaries are clear.",
    ["Explicit tool contracts", "Least-privilege access", "Confirmed write actions"],
    {
      title: "Start with a narrow contract",
      body: "Describe each tool's inputs, outputs, errors, and side effects. Separate read operations from writes and validate all server responses before presenting them as completed work.",
      points: [
        "Expose the minimum useful tool set",
        "Validate structured inputs and outputs",
        "Keep credentials outside model-visible content",
      ],
    },
    {
      title: "Design for user control",
      body: "Require clear authorization and confirmation for consequential actions. Test expired sessions, revoked scopes, retries, duplicate requests, and partial provider failures.",
      points: [
        "Confirm recipients, targets, and mutations",
        "Make disconnect and recovery understandable",
        "Retain evidence for operational review",
      ],
    },
    { label: "Read developer guidance", to: "/developers/tool-calling" },
  ),
  solution(
    "industries",
    "financial-services",
    "KovaGPT workflows for financial services",
    "Evaluate KovaGPT for financial-services workflows with data, calculation, review, and regulatory boundaries.",
    "Support research, analysis, drafting, and service workflows without presenting generated output as a verified transaction, filing, recommendation, or compliance decision.",
    ["Reconciled calculations", "Approved data only", "Human authorization"],
    {
      title: "Choose controlled workflows",
      body: "Begin with tasks that have defined inputs, approved sources, measurable outputs, and accountable reviewers. Document where regulated advice, suitability, disclosure, and recordkeeping obligations apply.",
      points: [
        "Separate drafts from approved records",
        "Reconcile figures to systems of record",
        "Prevent secrets from entering prompts or logs",
      ],
    },
    {
      title: "Verify before deployment",
      body: "Security, retention, residency, audit, support, and contractual requirements depend on the configured environment and written agreements. Test them against the intended workflow before launch.",
      points: [
        "Map identity and access roles",
        "Test adverse and ambiguous cases",
        "Keep qualified approval in the loop",
      ],
    },
    { label: "Discuss requirements", to: "/contact-sales" },
  ),
  solution(
    "industries",
    "government",
    "KovaGPT workflows for government",
    "Assess KovaGPT for public-sector work with procurement, records, accessibility, security, and oversight in scope.",
    "Explore bounded assistance for public information, analysis, drafting, and internal knowledge while preserving legal authority, public accountability, and human decision-making.",
    ["Public accountability", "Accessible workflows", "Human authority"],
    {
      title: "Define the public-service boundary",
      body: "Identify the governing policy, record owner, approved data classes, accessibility requirements, and review authority for each proposed workflow before handling live information.",
      points: [
        "Exclude restricted data unless explicitly approved",
        "Plan records and disclosure handling",
        "Provide accessible non-AI alternatives",
      ],
    },
    {
      title: "Pilot with measurable safeguards",
      body: "Test accuracy, bias, language access, failure recovery, and staff review on representative cases. Do not automate eligibility, enforcement, or rights-affecting decisions without appropriate authority and controls.",
      points: [
        "Publish a clear escalation path",
        "Measure errors across affected groups",
        "Retain an accountable human decision-maker",
      ],
    },
    { label: "Discuss requirements", to: "/contact-sales" },
  ),
  solution(
    "industries",
    "healthcare",
    "KovaGPT workflows for healthcare",
    "Evaluate KovaGPT for healthcare workflows without treating generated information as diagnosis or clinical authorization.",
    "Support administrative, education, research, and documentation tasks only within approved privacy, safety, clinical-review, and organizational boundaries.",
    ["Minimum necessary data", "Clinical review", "No emergency reliance"],
    {
      title: "Keep the workflow appropriately scoped",
      body: "Classify the data, intended users, clinical impact, evidence source, and required reviewer. Do not enter protected or identifying information unless the configured environment is explicitly approved for it.",
      points: [
        "Minimize sensitive information",
        "Separate education from patient-specific care",
        "Use authoritative clinical sources",
      ],
    },
    {
      title: "Preserve clinical responsibility",
      body: "Generated output can be incomplete, outdated, or wrong. Qualified professionals must review care-related material, and urgent or emergency needs belong with local emergency and clinical services.",
      points: [
        "Validate against current guidance",
        "Test unsafe and uncertain scenarios",
        "Never delay appropriate care",
      ],
    },
    { label: "Read health guidance", to: "/health" },
  ),
  solution(
    "industries",
    "retail",
    "KovaGPT workflows for retail",
    "Plan KovaGPT retail workflows with accurate catalog data, customer consent, and accountable operations.",
    "Support product discovery, service drafts, merchandising analysis, and internal knowledge while keeping prices, availability, policies, and customer-facing actions verifiable.",
    ["Catalog-grounded answers", "Consent-aware service", "Verified transactions"],
    {
      title: "Connect reliable commerce context",
      body: "Use approved product, inventory, policy, and order sources. Clearly separate a generated suggestion from a current price, in-stock promise, promotion, or completed account action.",
      points: [
        "Refresh time-sensitive catalog facts",
        "Protect customer and payment data",
        "Disclose sponsored or constrained results",
      ],
    },
    {
      title: "Review the customer journey",
      body: "Test search, comparison, returns, accessibility, escalation, and failure states. Purchases and account changes should expose the exact item, price, recipient, and confirmation step.",
      points: [
        "Measure relevance and error rates",
        "Offer a clear human support path",
        "Confirm consequential actions",
      ],
    },
    { label: "Explore shopping guidance", to: "/shopping" },
  ),
  solution(
    "use-case",
    "agents",
    "Build agentic workflows with KovaGPT",
    "Design KovaGPT agentic workflows with bounded tools, observable progress, and user-controlled actions.",
    "Break a goal into reviewable steps while preserving permissions, stopping conditions, confirmations, and a clear record of what actually happened.",
    ["Bounded execution", "Visible progress", "Confirmed actions"],
    {
      title: "Define the execution envelope",
      body: "Specify allowed tools, data, targets, cost and time limits, success criteria, and actions that always require confirmation. Treat missing authority as a stop condition.",
      points: [
        "Use least-privilege connections",
        "Separate plans from completed actions",
        "Set retry and termination limits",
      ],
    },
    {
      title: "Make every outcome inspectable",
      body: "Show progress, errors, external changes, and unresolved questions in language the user can verify. Test interruption, duplicate execution, stale state, and partial failure.",
      points: [
        "Retain action evidence",
        "Confirm consequential mutations",
        "Provide recovery and cancellation paths",
      ],
    },
    { label: "Explore assistants", to: "/assistants" },
  ),
  solution(
    "use-case",
    "coding",
    "Code with KovaGPT",
    "Use KovaGPT for planning, implementation, debugging, and review while repository owners keep control.",
    "Bring the exact codebase, environment, constraints, and acceptance criteria into a reviewable engineering workflow instead of treating generated code as deploy-ready.",
    ["Repository-scoped", "Tested changes", "Human-reviewed"],
    {
      title: "Give the work a concrete contract",
      body: "Identify the failing behavior or desired outcome, relevant files, supported runtime, security boundary, and tests. Ask for small changes that can be inspected independently.",
      points: [
        "Preserve unrelated worktree changes",
        "Keep secrets out of prompts and output",
        "Run the project's required checks",
      ],
    },
    {
      title: "Review before release",
      body: "Generated code can introduce logic, security, dependency, accessibility, and operational defects. Use branch protection, code review, automated checks, and staged deployment appropriate to the system.",
      points: [
        "Inspect the exact diff",
        "Test failure and rollback paths",
        "Keep deployment authorization explicit",
      ],
    },
    { label: "Explore coding workflows", to: "/codex" },
  ),
  solution(
    "use-case",
    "content-creation",
    "Create content with KovaGPT",
    "Draft and refine original content with KovaGPT while preserving accuracy, authorship, consent, and review.",
    "Move from a clear brief to structured drafts, alternatives, and edits without losing the evidence, permissions, or human judgment behind publication.",
    ["Brief-led drafting", "Original expression", "Publication review"],
    {
      title: "Start with purpose and constraints",
      body: "Name the audience, channel, tone, required facts, source material, accessibility needs, and prohibited claims. Request alternatives instead of imitating a living creator's distinctive style.",
      points: [
        "Use material you have rights to use",
        "Mark quotations and required attribution",
        "Separate facts from creative suggestions",
      ],
    },
    {
      title: "Edit for the real destination",
      body: "Review factual claims, originality, brand requirements, accessibility, privacy, and platform rules before publication. Preserve a human owner for the final message.",
      points: [
        "Verify names, dates, and links",
        "Check captions and alternative text",
        "Obtain consent for identifiable people",
      ],
    },
    { label: "Open the AI writer", to: "/ai-writer" },
  ),
  solution(
    "use-case",
    "data-analysis",
    "Analyze data with KovaGPT",
    "Use KovaGPT to explore and explain data with reproducible calculations and explicit quality checks.",
    "Turn a question and an approved dataset into a transparent analysis that records definitions, transformations, assumptions, uncertainty, and validation steps.",
    ["Defined metrics", "Reproducible work", "Quality checks"],
    {
      title: "Establish the analytical contract",
      body: "Define the decision, population, grain, time window, units, exclusions, and source of truth. Inspect missing values, duplicates, outliers, joins, and sampling before interpreting results.",
      points: [
        "Preserve original source data",
        "Show formulas and transformations",
        "Distinguish correlation from causation",
      ],
    },
    {
      title: "Validate every conclusion",
      body: "Recalculate key outputs in a trusted environment, compare with known totals, test sensitivity to assumptions, and state limitations beside the result.",
      points: [
        "Reconcile row counts and totals",
        "Use honest scales and labels",
        "Have domain owners review decisions",
      ],
    },
    { label: "Open Files", to: "/files" },
  ),
  solution(
    "use-case",
    "research",
    "Research with KovaGPT",
    "Plan, gather, compare, and communicate research with KovaGPT while keeping evidence reviewable.",
    "Convert a focused question into a source-backed workflow that separates retrieved evidence, interpretation, disagreement, uncertainty, and remaining gaps.",
    ["Focused scope", "Source-backed synthesis", "Visible uncertainty"],
    {
      title: "Build a defensible research plan",
      body: "Define the audience, decision, date range, jurisdictions, source types, exclusions, and stopping criteria. Search broadly enough to find competing explanations and negative evidence.",
      points: [
        "Prefer primary and authoritative sources",
        "Record search and selection limits",
        "Keep publication dates and event dates distinct",
      ],
    },
    {
      title: "Inspect support claim by claim",
      body: "A citation can be real yet fail to support the sentence beside it. Open important sources, check context, compare methods, and label inference rather than presenting it as fact.",
      points: [
        "Verify quotations and statistics",
        "Represent credible disagreement",
        "Refresh time-sensitive conclusions",
      ],
    },
    { label: "Open research guidance", to: "/research-assistant" },
  ),
];

export const PUBLIC_SOLUTION_PAGE_BY_KEY = new Map(
  PUBLIC_SOLUTION_PAGES.map((item) => [`${item.section}/${item.slug}`, item]),
);
