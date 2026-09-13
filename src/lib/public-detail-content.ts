import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

export type PublicDetailAction = Readonly<{ label: string; to: string }>;

export type PublicDetailPage = Readonly<{
  section: string;
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  summary: string;
  primaryAction: PublicDetailAction;
  secondaryAction?: PublicDetailAction;
  highlights: readonly string[];
  sections: readonly Readonly<{
    title: string;
    body: string;
    points: readonly string[];
  }>[];
}>;

const detail = (
  section: string,
  slug: string,
  eyebrow: string,
  title: string,
  description: string,
  summary: string,
  primaryAction: PublicDetailAction,
  highlights: readonly string[],
  sections: PublicDetailPage["sections"],
  secondaryAction: PublicDetailAction = { label: "Explore all features", to: "/features" },
): PublicDetailPage => ({
  section,
  slug,
  eyebrow,
  title,
  description,
  summary,
  primaryAction,
  secondaryAction,
  highlights,
  sections,
});

const workflow = (
  slug: string,
  title: string,
  summary: string,
  points: readonly string[],
): PublicDetailPage =>
  detail(
    "use-cases",
    slug,
    "Use case",
    title,
    `${title} with KovaGPT using clear inputs, reviewable outputs, and human judgment.`,
    summary,
    { label: "Start in KovaGPT", to: "/" },
    ["Bring your context", "Review the result", "Keep source material close"],
    [
      {
        title: "A practical workflow",
        body: "Describe the outcome, audience, constraints, and evidence you already have. Ask KovaGPT to separate known facts, assumptions, and open questions.",
        points,
      },
      {
        title: "Use judgment at the finish line",
        body: "Treat generated output as a working draft. Check time-sensitive facts, calculations, citations, safety implications, and decisions against authoritative sources.",
        points: [
          "Remove private information that is not needed",
          "Open and verify cited sources",
          "Have a qualified person review high-impact work",
        ],
      },
    ],
    { label: "Browse use cases", to: "/use-cases" },
  );

const business = (
  slug: string,
  title: string,
  summary: string,
  points: readonly string[],
): PublicDetailPage =>
  detail(
    "business",
    slug,
    "KovaGPT for business",
    title,
    `${title}: evaluate KovaGPT with explicit workflow, data, and review boundaries.`,
    summary,
    { label: "Discuss requirements", to: "/contact-sales" },
    ["Scoped evaluation", "Human review", "No invented assurances"],
    [
      {
        title: "Start with the work, not the tool",
        body: "Document the decisions, inputs, owners, acceptable sources, and review checkpoints before introducing AI into a team workflow.",
        points,
      },
      {
        title: "Confirm operational boundaries",
        body: "Availability depends on the configured identity, storage, provider, billing, and administrative environment. Contract and security claims require written verification.",
        points: [
          "Define approved data classes",
          "Test access and retention behavior",
          "Assign an accountable human owner",
        ],
      },
    ],
    { label: "KovaGPT for business", to: "/business" },
  );

const app = (
  slug: string,
  title: string,
  summary: string,
  points: readonly string[],
): PublicDetailPage =>
  detail(
    "apps",
    slug,
    "KovaGPT app",
    title,
    `Connect ${title} to KovaGPT using account-scoped authorization and explicit permissions.`,
    summary,
    { label: "Open Apps", to: "/apps" },
    ["Account-scoped", "Permission-aware", "Disconnect anytime"],
    [
      {
        title: "What the connection is for",
        body: "KovaGPT exposes only actions supported by the configured integration and the scopes you grant. A connection does not authorize unrelated accounts or hidden background work.",
        points,
      },
      {
        title: "Stay in control",
        body: "Provider credentials, granted scopes, account state, and service availability are checked before protected actions. Consequential actions require confirmation where supported.",
        points: [
          "Review the provider consent screen",
          "Use the minimum permissions you need",
          "Disconnect from the Apps page when finished",
        ],
      },
    ],
    { label: "App connection guidance", to: "/features/plugins" },
  );

const unavailableApp = (slug: string, title: string): PublicDetailPage =>
  detail(
    "apps",
    slug,
    "KovaGPT app compatibility",
    title,
    `${title} is catalogued for KovaGPT compatibility review but is not currently a connectable integration.`,
    `KovaGPT does not currently expose a working ${title} connection. This page records the boundary and points to integrations that are actually available.`,
    { label: "Browse working Apps", to: "/apps" },
    ["Not currently connectable", "No permissions requested", "No implied partnership"],
    [
      {
        title: "Current availability",
        body: `There is no active ${title} authorization flow in KovaGPT. Do not enter provider credentials or expect KovaGPT to read or change ${title} data.`,
        points: [
          "No account connection is offered",
          "No background access is claimed",
          "No provider endorsement is implied",
        ],
      },
      {
        title: "Use a supported path",
        body: "The Apps directory distinguishes working integrations from unavailable catalog entries. A provider becomes actionable only after authorization, scope, disconnect, and end-to-end tool behavior are verified.",
        points: [
          "Review the working-app list",
          "Use minimum permissions",
          "Confirm consequential actions",
        ],
      },
    ],
    { label: "How Apps work", to: "/features/plugins" },
  );

const unavailableFeature = (slug: string, title: string): PublicDetailPage =>
  detail(
    "features",
    slug,
    "Feature availability",
    title,
    `${title} is not currently an available KovaGPT capability.`,
    `KovaGPT documents ${title.toLowerCase()} without presenting an inactive control or implying that audio capture, playback, or live video is available.`,
    { label: "Explore available features", to: "/features" },
    ["Not currently available", "No hidden recording", "Availability must be verified"],
    [
      {
        title: "Current boundary",
        body: "KovaGPT currently accepts supported text and file inputs. No voice or live-video session starts from this page.",
        points: [
          "No microphone permission is requested",
          "No recording begins in the background",
          "No availability date is promised",
        ],
      },
      {
        title: "What readiness would require",
        body: "A future release would need explicit permission, recording indicators, interruption controls, accessible alternatives, retention disclosure, and end-to-end verification before the interface becomes actionable.",
        points: [
          "Clear start and stop controls",
          "Visible capture state",
          "Text alternatives and privacy review",
        ],
      },
    ],
  );

const unavailablePlan = (slug: string, title: string, audience: string): PublicDetailPage =>
  detail(
    "plans",
    slug,
    "Plan availability",
    title,
    `${title} is not currently an active KovaGPT subscription plan.`,
    `${audience} can review KovaGPT's published Free, Plus, and Pro plans without being routed into an unavailable checkout.`,
    { label: "Compare active plans", to: "/pricing" },
    ["Not available for purchase", "No unpublished price", "No checkout dead end"],
    [
      {
        title: "Published plans are authoritative",
        body: "KovaGPT only treats plans backed by the product capability registry and active checkout configuration as purchasable.",
        points: [
          "Free, Plus, and Pro are the published individual plans",
          "Checkout confirms current paid terms",
          "Account eligibility can affect availability",
        ],
      },
      {
        title: "Needs are still welcome",
        body: "Schools and organizations can document users, data boundaries, identity, review, accessibility, and support requirements without assuming a plan exists.",
        points: [
          "Define the intended workflow",
          "Protect student and organizational data",
          "Confirm commitments in writing",
        ],
      },
    ],
    { label: "Discuss organization needs", to: "/contact-sales" },
  );

const translationDetail = (slug: string, title: string): PublicDetailPage =>
  detail(
    "translate",
    slug,
    "Translation workflow",
    title,
    `${title} with KovaGPT while preserving context and human review.`,
    "Provide the source text, audience, locale, tone, and terminology constraints, then review the result for meaning, nuance, and high-impact consequences.",
    { label: "Open translation guidance", to: "/translation" },
    ["Context-aware draft", "Terminology guidance", "Human review required"],
    [
      {
        title: "Preserve meaning",
        body: "Include the intended audience, regional usage, names, formatting, and terms that should remain unchanged. Ask for alternatives when wording is ambiguous.",
        points: ["Keep the source text", "Name the target locale", "Review idiom and tone"],
      },
      {
        title: "Use qualified review when needed",
        body: "Generated translations can omit nuance or introduce errors. Legal, medical, safety, immigration, financial, and publication-ready material needs a qualified reviewer.",
        points: [
          "Verify critical terms",
          "Protect private information",
          "Do not rely on unchecked output",
        ],
      },
    ],
    { label: "Explore language workflows", to: "/translation" },
  );

const planPages = (["free", "plus", "pro"] as const).map((tier) => {
  const plan = CAPABILITY_REGISTRY.plans[tier];
  const price = plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd} per month`;
  return detail(
    "plans",
    tier,
    "KovaGPT plan",
    `KovaGPT ${plan.name}`,
    `${plan.name} plan details, published capabilities, and current product boundaries.`,
    plan.description,
    {
      label: tier === "free" ? "Open KovaGPT" : `Choose ${plan.name}`,
      to: tier === "free" ? "/" : "/pricing",
    },
    [price, `${plan.features.length} published benefits`, "Checkout confirms paid terms"],
    [
      {
        title: "What is included",
        body: "The plan catalog is owned by KovaGPT’s product configuration so the marketing page and pricing flow use the same capability source.",
        points: plan.features,
      },
      {
        title: "What to confirm",
        body: "Provider-backed features still require service availability and account eligibility. For paid plans, Stripe checkout is the final source for price, trial eligibility, renewal timing, and payment terms.",
        points: [
          "Review the checkout total before purchase",
          "Check current usage limits in the product",
          "Manage available subscription actions from Settings",
        ],
      },
    ],
    { label: "Compare all plans", to: "/pricing" },
  );
});

export const PUBLIC_DETAIL_PAGES: readonly PublicDetailPage[] = [
  detail(
    "features",
    "deep-research",
    "Feature",
    "Deep Research",
    "Create a longer, source-backed report with KovaGPT when Deep Research is available.",
    CAPABILITY_REGISTRY.features.deepResearch.summary,
    { label: "Plan research", to: "/research-planner" },
    ["Multi-stage workflow", "Source-backed report", "Plus and Pro when available"],
    [
      {
        title: "From question to report",
        body: "Start with a focused research question and constraints. KovaGPT plans the work, gathers permitted sources, compares evidence, and assembles a structured report.",
        points: [
          "Define scope and date range",
          "Inspect cited evidence",
          "Revise the plan as needed",
        ],
      },
      {
        title: "Evidence still needs review",
        body:
          CAPABILITY_REGISTRY.features.deepResearch.limitation ?? "Review every important claim.",
        points: [
          "A citation can be relevant without proving a claim",
          "Current information can change",
          "High-impact conclusions need qualified review",
        ],
      },
    ],
  ),
  detail(
    "features",
    "plugins",
    "Feature",
    "Apps and integrations",
    "Connect supported services to KovaGPT with explicit account and permission boundaries.",
    CAPABILITY_REGISTRY.features.apps.summary,
    { label: "Browse Apps", to: "/apps" },
    ["Google services", "GitHub", "Provider-dependent"],
    [
      {
        title: "Only working connections are actionable",
        body: "KovaGPT keeps unavailable catalog entries non-actionable and checks configured credentials, scopes, and provider health before use.",
        points: CAPABILITY_REGISTRY.workingApps,
      },
      {
        title: "Authorization remains specific",
        body: CAPABILITY_REGISTRY.features.apps.limitation ?? "Each connection has its own limits.",
        points: [
          "Review requested scopes",
          "Confirm consequential actions",
          "Disconnect at any time",
        ],
      },
    ],
  ),
  detail(
    "features",
    "study-mode",
    "Feature",
    "Study with KovaGPT",
    "Learn through explanations, practice, and reflection without replacing educators or source material.",
    "Turn a topic into a guided session with goals, questions, practice prompts, and a review step.",
    { label: "Open Study", to: "/study" },
    ["Guided practice", "Explain step by step", "Academic-integrity aware"],
    [
      {
        title: "Build understanding",
        body: "Ask KovaGPT to diagnose what you know, explain one concept at a time, and create practice that matches your level.",
        points: [
          "State the course and level",
          "Try before revealing answers",
          "Explain mistakes in your own words",
        ],
      },
      {
        title: "Keep learning accountable",
        body: "Follow your institution’s rules, cite sources, and disclose AI assistance when required.",
        points: [
          "Verify facts in course materials",
          "Do not submit unchecked output",
          "Ask an educator when stakes are high",
        ],
      },
    ],
  ),
  detail(
    "features",
    "chat-with-pdfs",
    "Feature",
    "Work with documents",
    "Use supported files as context while keeping the original document available for verification.",
    CAPABILITY_REGISTRY.features.attachments.summary,
    { label: "Open Files", to: "/files" },
    ["Focused questions", "Reviewable summaries", "Format limits are explicit"],
    [
      {
        title: "Ask against the source",
        body: "Upload a supported file, name the passages or questions that matter, and request a structured answer that distinguishes extraction from interpretation.",
        points: [
          "Keep the original open",
          "Ask for locations or excerpts",
          "Check tables, scans, and footnotes manually",
        ],
      },
      {
        title: "Know the current boundary",
        body:
          CAPABILITY_REGISTRY.features.attachments.limitation ?? "File support varies by format.",
        points: [
          "Do not assume every layout was extracted",
          "Remove unnecessary private data",
          "Verify consequential conclusions",
        ],
      },
    ],
  ),
  unavailableFeature("voice", "Voice with KovaGPT"),
  unavailableFeature("voice-with-video", "Voice with video"),
  ...planPages,
  unavailablePlan("go", "KovaGPT Go", "People looking for a lower-cost plan"),
  unavailablePlan("k12-teachers", "KovaGPT for K–12 teachers", "K–12 educators and schools"),
  workflow(
    "chat-with-presentations",
    "Work with presentations",
    "Outline, review, and refine presentations while keeping claims and visual decisions accountable.",
    [
      "Define the audience and decision",
      "Create a slide-by-slide narrative",
      "Review accessibility and evidence",
    ],
  ),
  workflow(
    "chat-with-spreadsheets",
    "Work with spreadsheets",
    "Reason about tabular data, formulas, and summaries with explicit calculation and data-quality checks.",
    [
      "Describe columns and units",
      "Ask for calculation steps",
      "Reconcile results with the source workbook",
    ],
  ),
  workflow(
    "fitness-wellness-and-health",
    "Fitness, wellness, and health",
    "Organize questions and general information without treating generated output as diagnosis or care.",
    [
      "Separate goals from symptoms",
      "Use reputable health sources",
      "Consult a qualified professional for medical decisions",
    ],
  ),
  workflow(
    "money-and-finances",
    "Money and finances",
    "Structure budgets, comparisons, and questions without presenting generated output as individualized financial advice.",
    [
      "State currency and time period",
      "Show assumptions and calculations",
      "Verify rates, tax, and legal consequences",
    ],
  ),
  workflow(
    "recipes-cooking",
    "Recipes and cooking",
    "Plan meals and adapt recipes while checking allergies, temperatures, storage, and food-safety guidance.",
    [
      "List dietary constraints",
      "Confirm quantities and equipment",
      "Use authoritative food-safety temperatures",
    ],
  ),
  workflow(
    "science-medicine",
    "Science and medicine",
    "Explore scientific literature and medical questions with clear uncertainty and source boundaries.",
    [
      "Prefer primary research and guidelines",
      "Distinguish evidence from hypothesis",
      "Escalate medical decisions to qualified care",
    ],
  ),
  workflow(
    "students",
    "KovaGPT for students",
    "Use explanations, practice, and planning to support learning while following academic-integrity rules.",
    [
      "Set a learning objective",
      "Practice retrieval before hints",
      "Cite sources and disclose assistance",
    ],
  ),
  workflow(
    "teachers",
    "KovaGPT for teachers",
    "Draft lesson materials and differentiated activities with educator review and local policy in control.",
    [
      "Define age and curriculum",
      "Review bias and accessibility",
      "Never upload unnecessary student data",
    ],
  ),
  workflow(
    "travel-and-exploration",
    "Travel and exploration",
    "Organize options and itineraries, then verify live schedules, entry rules, safety guidance, and bookings directly.",
    [
      "State dates, budget, and mobility needs",
      "Check official travel advisories",
      "Confirm reservations with providers",
    ],
  ),
  workflow(
    "university-educators",
    "KovaGPT for university educators",
    "Explore course planning, research discussion, and feedback workflows with academic policy and subject expertise in charge.",
    [
      "Publish an AI-use policy",
      "Protect student and research data",
      "Review citations and disciplinary nuance",
    ],
  ),
  workflow(
    "veterans",
    "KovaGPT for veterans",
    "Organize questions and public resources without replacing official benefit, legal, health, or crisis services.",
    [
      "Use official agency sources",
      "Avoid sharing sensitive identifiers",
      "Contact qualified services for eligibility decisions",
    ],
  ),
  business(
    "ai-for-data-science-analytics",
    "AI for data science and analytics",
    "Support exploration, query drafting, documentation, and interpretation with reproducible analysis and data owners in control.",
    [
      "Define metric and grain",
      "Validate data quality",
      "Reproduce calculations outside the model",
    ],
  ),
  business(
    "ai-for-engineering",
    "AI for engineering",
    "Support planning, code review, debugging, and documentation without bypassing tests, security review, or change control.",
    [
      "Provide the exact environment",
      "Run tests and static checks",
      "Review security-sensitive changes",
    ],
  ),
  business(
    "ai-for-finance",
    "AI for finance teams",
    "Assist with structured analysis and drafting while preserving controls around financial data, approvals, and regulated decisions.",
    [
      "Use approved data boundaries",
      "Reconcile every calculation",
      "Retain human approval for filings and transactions",
    ],
  ),
  business(
    "ai-for-product-management",
    "AI for product management",
    "Synthesize owned research, draft requirements, and compare options while keeping evidence and decision ownership visible.",
    [
      "Separate evidence from opinion",
      "Link requirements to user needs",
      "Record unresolved risks",
    ],
  ),
  business(
    "ai-for-sales-marketing",
    "AI for sales and marketing",
    "Draft and organize customer-facing work with brand, consent, accuracy, and approval controls.",
    [
      "Use approved claims",
      "Respect contact and consent rules",
      "Review personalization before sending",
    ],
  ),
  business(
    "education",
    "AI for education organizations",
    "Evaluate learning and administrative workflows with privacy, pedagogy, access, and institutional policy at the center.",
    [
      "Minimize student data",
      "Define educator oversight",
      "Test accessibility and learning impact",
    ],
  ),
  business(
    "enterprise",
    "Enterprise AI deployment workflows",
    "Scope identity, retention, security, procurement, support, and deployment requirements before representing a capability as ready.",
    ["Map identity and access", "Document retention needs", "Verify contractual commitments"],
  ),
  app(
    "google-drive",
    "Google Drive",
    "Reference permitted Drive files in supported KovaGPT workflows after connecting the intended Google account.",
    [
      "Choose the correct Google account",
      "Grant only requested Drive scopes",
      "Recheck access before each protected read",
    ],
  ),
  app(
    "gmail",
    "Gmail",
    "Draft and work with permitted email context while keeping sending and account authorization explicit.",
    [
      "Review recipients and message body",
      "Confirm before consequential sends",
      "Do not expose unrelated mailbox data",
    ],
  ),
  app(
    "google-calendar",
    "Google Calendar",
    "Review permitted calendar context and prepare event actions with timezone and attendee details visible.",
    [
      "Confirm timezone and duration",
      "Review attendees",
      "Confirm before creating or changing events",
    ],
  ),
  app(
    "github",
    "GitHub",
    "Work with explicitly granted repositories while preserving installation, repository, and write-approval boundaries.",
    [
      "Select allowed repositories",
      "Keep read and write scopes distinct",
      "Confirm repository changes",
    ],
  ),
  unavailableApp("canva", "Canva"),
  unavailableApp("powerpoint", "Microsoft PowerPoint"),
  unavailableApp("spotify", "Spotify"),
  detail(
    "codex",
    "enterprise",
    "Coding for organizations",
    "KovaGPT coding workflows for enterprise teams",
    "Evaluate KovaGPT coding workflows with repository, identity, data, review, and deployment boundaries.",
    "Teams can assess coding assistance without assuming autonomous repository access, enterprise certification, or unreviewed deployment rights.",
    { label: "Discuss requirements", to: "/contact-sales" },
    ["Repository-scoped", "Human-reviewed", "Deployment controls required"],
    [
      {
        title: "Scope the engineering workflow",
        body: "Define repositories, data classes, allowed tools, branch protections, reviewers, and release controls before enabling AI-assisted changes.",
        points: [
          "Keep credentials server-side",
          "Require tests and review",
          "Preserve audit evidence",
        ],
      },
      {
        title: "Verify the environment",
        body: "Identity, retention, networking, provider access, and contractual commitments depend on the configured deployment and written agreement.",
        points: ["Map access roles", "Test failure recovery", "Confirm support boundaries"],
      },
    ],
    { label: "Engineering use case", to: "/business/ai-for-engineering" },
  ),
  detail(
    "codex",
    "pricing",
    "Coding plan guidance",
    "KovaGPT coding access and pricing",
    "Understand how KovaGPT coding tools relate to published plans without inventing a separate coding subscription.",
    "KovaGPT does not publish a standalone coding price. Available models, tools, and limits come from the active plan and server capability registry.",
    { label: "View current pricing", to: "/pricing" },
    ["No separate coding plan", "Plan controls apply", "Checkout is authoritative"],
    [
      {
        title: "Use the published plan catalog",
        body: "The pricing page and checkout flow are the authoritative surfaces for active plans and commercial terms.",
        points: ["Compare plan benefits", "Review usage limits", "Confirm checkout terms"],
      },
      {
        title: "Tool access remains bounded",
        body: "A paid plan does not bypass repository authorization, provider readiness, safety checks, or human review.",
        points: [
          "Connect only intended repositories",
          "Review generated changes",
          "Run required checks",
        ],
      },
    ],
    { label: "Explore coding workflows", to: "/codex" },
  ),
  translationDetail("english-to-french", "Translate English to French"),
  translationDetail("english-to-hindi", "Translate English to Hindi"),
  translationDetail("english-to-marathi", "Translate English to Marathi"),
  translationDetail("english-to-portuguese", "Translate English to Portuguese"),
  translationDetail("english-to-tagalog", "Translate English to Tagalog"),
  translationDetail("english-to-tamil", "Translate English to Tamil"),
  translationDetail("english-to-urdu", "Translate English to Urdu"),
  translationDetail("hindi-to-english", "Translate Hindi to English"),
  translationDetail("spanish-to-english", "Translate Spanish to English"),
  translationDetail("tagalog-to-english", "Translate Tagalog to English"),
  detail(
    "writing",
    "paraphrase",
    "Writing workflow",
    "Paraphrase with KovaGPT",
    "Rewrite supplied text for clarity, tone, or structure while preserving meaning and attribution.",
    "Use KovaGPT to draft alternatives, then compare them with the source so facts, quotations, citations, and the author's intent remain accurate.",
    { label: "Open the AI writer", to: "/ai-writer" },
    ["Meaning first", "Tone controls", "Attribution preserved"],
    [
      {
        title: "Give a clear brief",
        body: "State the audience, purpose, tone, length, reading level, and details that must not change.",
        points: ["Provide the source", "Mark exact quotations", "Name required terminology"],
      },
      {
        title: "Review the rewrite",
        body: "Paraphrasing does not remove copyright, plagiarism, confidentiality, or attribution obligations.",
        points: [
          "Compare meaning line by line",
          "Keep required citations",
          "Follow publication rules",
        ],
      },
    ],
    { label: "Writing guidance", to: "/ai-writer" },
  ),
  detail(
    "students",
    "2026",
    "Student guide",
    "KovaGPT student guide for 2026",
    "Use KovaGPT for learning, planning, and practice in 2026 while following current course and institution rules.",
    "Build understanding with guided questions and reviewable drafts. Policies and product capabilities can change, so confirm both before relying on a workflow.",
    { label: "Open Study", to: "/study" },
    ["Active learning", "Current policy checks", "Academic integrity"],
    [
      {
        title: "Learn actively",
        body: "Set an objective, attempt the problem first, request targeted hints, and explain the final reasoning in your own words.",
        points: ["Practice retrieval", "Ask for feedback", "Verify against course material"],
      },
      {
        title: "Follow current rules",
        body: "Your course, institution, and assessment instructions determine acceptable AI use. Disclose assistance and cite sources when required.",
        points: ["Check the syllabus", "Protect student data", "Do not submit unchecked output"],
      },
    ],
    { label: "Student resources", to: "/college-students" },
  ),
];

export const PUBLIC_DETAIL_PAGE_BY_KEY = new Map(
  PUBLIC_DETAIL_PAGES.map((item) => [`${item.section}/${item.slug}`, item]),
);
