import type { PublicDetailPage } from "@/lib/public-detail-content";

type AcademyTopic = Readonly<{
  slug: string;
  title: string;
  description: string;
  summary: string;
  outcomes: readonly [string, string, string];
  practice: readonly [string, string, string];
  safeguards: readonly [string, string, string];
  action: PublicDetailPage["primaryAction"];
}>;

const academy = (topic: AcademyTopic): PublicDetailPage => ({
  section: "academy",
  slug: topic.slug,
  eyebrow: "Kova Academy",
  title: topic.title,
  description: topic.description,
  summary: topic.summary,
  highlights: topic.outcomes,
  primaryAction: topic.action,
  secondaryAction: { label: "Browse Kova Academy", to: "/academy" },
  sections: [
    {
      title: "What you will practice",
      body: `This Kova Academy guide turns ${topic.title.toLowerCase()} into a bounded exercise. Start with an outcome, the context you are allowed to use, and the person responsible for the finished work.`,
      points: topic.practice,
    },
    {
      title: "Keep the result dependable",
      body: "Treat every generated answer as a draft until its important claims, calculations, sources, permissions, and downstream effects have been checked. Product availability depends on the current account and configured services.",
      points: topic.safeguards,
    },
  ],
});

const topics: readonly AcademyTopic[] = [
  {
    slug: "ai-fundamentals",
    title: "AI fundamentals for practical work",
    description:
      "Learn core AI concepts with KovaGPT, including prompts, context, uncertainty, evaluation, and human review.",
    summary:
      "Build a working mental model of generative AI so you can choose appropriate tasks, give useful context, and recognize where verification is essential.",
    outcomes: ["Understand model limits", "Write clearer instructions", "Evaluate outputs"],
    practice: [
      "Compare a vague request with a constrained one",
      "Separate generated language from verified evidence",
      "Create a simple accuracy and usefulness checklist",
    ],
    safeguards: [
      "Do not treat confidence as correctness",
      "Verify current facts with authoritative sources",
      "Keep accountable people in consequential decisions",
    ],
    action: { label: "Start with KovaGPT", to: "/" },
  },
  {
    slug: "applications-of-ai",
    title: "Choose useful applications of AI",
    description:
      "Identify appropriate KovaGPT use cases by mapping work, inputs, risks, reviewers, and measurable outcomes.",
    summary:
      "Move from broad AI ideas to a short list of workflows where assistance is useful, observable, and compatible with your data and decision boundaries.",
    outcomes: ["Map the workflow", "Prioritize bounded tasks", "Define success"],
    practice: [
      "List repetitive and judgment-heavy steps separately",
      "Name the approved inputs and expected output",
      "Select a measurable pilot with a clear owner",
    ],
    safeguards: [
      "Exclude workflows without appropriate authority",
      "Test representative failures before launch",
      "Document when human approval is required",
    ],
    action: { label: "Explore Kova workflows", to: "/use-cases" },
  },
  {
    slug: "brainstorming",
    title: "Brainstorm without losing the brief",
    description:
      "Use KovaGPT to generate, group, challenge, and refine ideas while preserving constraints and ownership.",
    summary:
      "Create a wider option set, then deliberately narrow it against audience needs, evidence, feasibility, cost, and the goal you actually need to reach.",
    outcomes: ["Generate varied options", "Challenge assumptions", "Choose with criteria"],
    practice: [
      "State the audience, objective, exclusions, and constraints",
      "Request options from several distinct perspectives",
      "Score the shortlist against explicit criteria",
    ],
    safeguards: [
      "Do not present generated ideas as researched facts",
      "Check originality and third-party rights",
      "Record why the final direction was selected",
    ],
    action: { label: "Open KovaGPT", to: "/" },
  },
  {
    slug: "building-with-ai",
    title: "Build reliable AI-assisted workflows",
    description:
      "Plan an AI-assisted workflow with KovaGPT using explicit inputs, tool boundaries, tests, and recovery paths.",
    summary:
      "Design the complete system around the model: authorization, data flow, evaluation, confirmations, monitoring, and a safe response when a dependency fails.",
    outcomes: ["Bound the system", "Test real scenarios", "Plan recovery"],
    practice: [
      "Define input, output, tool, and permission contracts",
      "Create expected, ambiguous, and adverse test cases",
      "Specify retry, escalation, and stopping behavior",
    ],
    safeguards: [
      "Keep credentials outside model-visible context",
      "Confirm consequential writes before execution",
      "Measure the end-to-end workflow, not a demo answer",
    ],
    action: { label: "Read developer guidance", to: "/developers" },
  },
  {
    slug: "champion-programs",
    title: "Run an internal AI champion program",
    description:
      "Create a responsible internal AI champion program with scoped pilots, shared learning, and accountable governance.",
    summary:
      "Equip a cross-functional group to discover useful workflows, teach safe practices, collect evidence, and escalate policy or operational questions to the right owners.",
    outcomes: ["Recruit useful perspectives", "Share reviewed patterns", "Track outcomes"],
    practice: [
      "Choose champions across roles, regions, and access needs",
      "Maintain a library of approved examples and anti-patterns",
      "Review adoption, quality, time saved, and incidents",
    ],
    safeguards: [
      "Do not let champions replace security or legal owners",
      "Publish approved data-handling boundaries",
      "Retire patterns that no longer match the product",
    ],
    action: { label: "Discuss organization needs", to: "/contact-sales" },
  },
  {
    slug: "chatgpt-for-education",
    title: "AI assistance for education",
    description:
      "Evaluate KovaGPT for teaching and learning with academic integrity, privacy, accessibility, and educator oversight.",
    summary:
      "Use guided explanations, practice, and feedback to strengthen learning without replacing course materials, institutional policy, or the educator's judgment.",
    outcomes: ["Support active learning", "Protect student data", "Follow course rules"],
    practice: [
      "Set a learning objective before opening the tool",
      "Ask for hints and feedback before complete answers",
      "Compare explanations with approved course sources",
    ],
    safeguards: [
      "Follow institution and assessment policies",
      "Minimize personal and student information",
      "Disclose and cite AI assistance when required",
    ],
    action: { label: "Open Study", to: "/study" },
  },
  {
    slug: "chatgpt-for-work",
    title: "Use KovaGPT for everyday work",
    description:
      "Structure everyday KovaGPT work with clear briefs, approved context, review checkpoints, and human-owned decisions.",
    summary:
      "Turn drafting, analysis, research, and planning into repeatable workflows where inputs and generated results remain visible to the people responsible for the outcome.",
    outcomes: ["Write a strong brief", "Reuse reviewable steps", "Keep ownership clear"],
    practice: [
      "Name the audience, decision, constraints, and deadline",
      "Attach only approved and necessary context",
      "Request a draft, critique, and final review checklist",
    ],
    safeguards: [
      "Verify business-critical facts and calculations",
      "Do not imply an external action was completed",
      "Use qualified review for high-impact work",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "chatgpt-sites",
    title: "Publish a focused site from reviewed content",
    description:
      "Plan and publish a Kova site with an explicit audience, content hierarchy, accessibility checks, and final review.",
    summary:
      "Shape source material into a navigable web experience, check every claim and destination, and publish only content you own or are authorized to use.",
    outcomes: ["Clarify the audience", "Build a useful hierarchy", "Verify before publishing"],
    practice: [
      "Define the primary task and supporting information",
      "Draft concise headings, sections, and calls to action",
      "Test navigation at phone and desktop widths",
    ],
    safeguards: [
      "Check ownership of text, images, and data",
      "Provide keyboard and readable contrast support",
      "Confirm forms and links before publication",
    ],
    action: { label: "Open Sites", to: "/sites" },
  },
  {
    slug: "chatgpt-work",
    title: "Coordinate multi-step work with KovaGPT",
    description:
      "Use KovaGPT Work for bounded research, files, analysis, drafting, and execution with visible progress and controls.",
    summary:
      "Break a larger objective into inspectable steps, supply only the necessary context, and keep tool permissions, confirmations, and stopping conditions explicit.",
    outcomes: ["Plan inspectable steps", "Control tool access", "Review outcomes"],
    practice: [
      "Define completion criteria and excluded actions",
      "Choose the minimum tools and files needed",
      "Inspect progress, evidence, and unresolved questions",
    ],
    safeguards: [
      "Stop when authority or context is missing",
      "Confirm recipients and external mutations",
      "Review every material change before handoff",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "chatgpt-work/how-business-operations-teams-use-codex",
    title: "Coding assistance for business operations",
    description:
      "Help operations teams automate bounded technical work with KovaGPT while preserving controls, tests, and process ownership.",
    summary:
      "Translate a documented operational bottleneck into a small, testable script or integration without bypassing business approvals or changing production systems invisibly.",
    outcomes: ["Map the process", "Automate a bounded step", "Preserve controls"],
    practice: [
      "Document the current process and system owners",
      "Create fixtures for expected and exceptional cases",
      "Review logs, retries, and rollback behavior",
    ],
    safeguards: [
      "Use test environments before production",
      "Protect customer, employee, and financial data",
      "Require approval for consequential changes",
    ],
    action: { label: "Open coding guidance", to: "/code-helper" },
  },
  {
    slug: "chatgpt-work/how-data-science-teams-use-codex",
    title: "Coding assistance for data science teams",
    description:
      "Use KovaGPT for data-science code, diagnostics, and documentation with reproducible inputs and validated results.",
    summary:
      "Accelerate exploration and implementation while keeping datasets, transformations, assumptions, metrics, and evaluation artifacts available for independent review.",
    outcomes: ["Make analysis reproducible", "Test data assumptions", "Validate metrics"],
    practice: [
      "Create a data dictionary and quality checks",
      "Ask for small reviewable code changes",
      "Compare results with a trusted baseline",
    ],
    safeguards: [
      "Prevent sensitive rows from entering prompts",
      "Check leakage, bias, and sampling limitations",
      "Re-run generated code in the supported environment",
    ],
    action: { label: "Open coding guidance", to: "/code-helper" },
  },
  {
    slug: "chatgpt-work/how-sales-teams-use-codex",
    title: "Coding assistance for sales operations",
    description:
      "Use KovaGPT to improve sales-operation tooling with consent-aware data handling, tests, and human-controlled outreach.",
    summary:
      "Build bounded helpers for data cleanup, reporting, and workflow integration while leaving customer contact, pricing, commitments, and record changes under accountable control.",
    outcomes: ["Clean data carefully", "Automate reports", "Control outreach"],
    practice: [
      "Define CRM fields and authoritative systems",
      "Test deduplication and transformation rules",
      "Preview every customer-facing action",
    ],
    safeguards: [
      "Honor consent and communication preferences",
      "Do not invent customer facts or commitments",
      "Confirm bulk changes and recipients",
    ],
    action: { label: "Open coding guidance", to: "/code-helper" },
  },
  {
    slug: "codex",
    title: "A reviewable Kova coding workflow",
    description:
      "Plan, implement, test, and review code with KovaGPT while repository owners retain control of changes and deployment.",
    summary:
      "Give coding work a concrete contract: the target behavior, relevant files, supported runtime, security boundary, tests, and evidence required before merge.",
    outcomes: ["Scope the change", "Run project checks", "Review the diff"],
    practice: [
      "Reproduce the problem or state acceptance criteria",
      "Keep changes small enough to inspect",
      "Run focused and regression tests",
    ],
    safeguards: [
      "Keep secrets and credentials out of output",
      "Preserve unrelated repository changes",
      "Do not deploy without authorized review",
    ],
    action: { label: "Open Code Helper", to: "/code-helper" },
  },
  {
    slug: "custom-gpts",
    title: "Design a custom Kova assistant",
    description:
      "Create a custom Kova assistant with a narrow purpose, owned instructions, safe knowledge, and tested boundaries.",
    summary:
      "Turn a repeated workflow into a reusable assistant only after its audience, permitted context, refusal behavior, handoffs, and maintenance owner are explicit.",
    outcomes: ["Define one purpose", "Curate approved context", "Test boundaries"],
    practice: [
      "Write a concise role and non-goals",
      "Add only authorized and maintained knowledge",
      "Test normal, ambiguous, and adversarial requests",
    ],
    safeguards: [
      "Do not embed secrets in instructions",
      "Avoid implying professional authority",
      "Assign an owner for updates and retirement",
    ],
    action: { label: "Browse assistants", to: "/assistants" },
  },
  {
    slug: "customer-success",
    title: "AI workflows for customer success",
    description:
      "Support customer-success research and drafting with KovaGPT while keeping account facts, promises, and actions verified.",
    summary:
      "Summarize approved account context, prepare meeting material, and draft follow-up options without fabricating customer history or silently changing external records.",
    outcomes: ["Prepare with context", "Draft useful follow-up", "Keep promises accurate"],
    practice: [
      "Identify the account system of record",
      "Separate direct customer facts from inference",
      "Review owners and dates for every commitment",
    ],
    safeguards: [
      "Minimize personal and confidential data",
      "Verify product and contract details",
      "Confirm messages and account changes",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "data-analysis",
    title: "Analyze data with a verification trail",
    description:
      "Use KovaGPT for data analysis with defined metrics, quality checks, reproducible calculations, and transparent uncertainty.",
    summary:
      "Start with the decision and data dictionary, inspect missing or inconsistent values, calculate with reproducible methods, and present conclusions no stronger than the evidence.",
    outcomes: ["Define metrics", "Check data quality", "Explain uncertainty"],
    practice: [
      "State the population, grain, time range, and units",
      "Profile missing, duplicate, and invalid values",
      "Reconcile key results with an independent calculation",
    ],
    safeguards: [
      "Do not upload data without authorization",
      "Distinguish correlation from causation",
      "Retain assumptions and transformation steps",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "finance",
    title: "AI workflows for finance teams",
    description:
      "Use KovaGPT for finance drafting and analysis with reconciled figures, controlled data, and qualified approval.",
    summary:
      "Support variance explanations, scenario drafts, documentation, and research while financial records, forecasts, filings, and approvals remain grounded in authoritative systems.",
    outcomes: ["Reconcile figures", "Document assumptions", "Preserve approval"],
    practice: [
      "Name the ledger, report, and reporting period",
      "Separate actuals, estimates, and scenarios",
      "Tie calculated outputs back to source totals",
    ],
    safeguards: [
      "Protect material nonpublic and personal data",
      "Check formulas, units, currencies, and dates",
      "Require qualified review for financial decisions",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "financial-services",
    title: "Responsible AI in financial services",
    description:
      "Evaluate KovaGPT for financial-services work with suitability, disclosure, recordkeeping, and human authorization in scope.",
    summary:
      "Explore bounded research, service, and drafting workflows without presenting generated output as verified advice, a completed transaction, a filing, or a compliance determination.",
    outcomes: ["Choose bounded workflows", "Preserve records", "Keep human authority"],
    practice: [
      "Map the applicable policy and accountable owner",
      "Test outputs against reviewed representative cases",
      "Document required disclosures and retention",
    ],
    safeguards: [
      "Do not infer suitability or eligibility",
      "Reconcile all figures to systems of record",
      "Obtain required legal and compliance review",
    ],
    action: { label: "Discuss requirements", to: "/contact-sales" },
  },
  {
    slug: "getting-started",
    title: "Get started with Kova Academy",
    description:
      "Learn a simple KovaGPT workflow: set a goal, provide approved context, request a format, and verify the result.",
    summary:
      "Complete a first useful task while learning the habits that make AI assistance clearer, safer, and easier to review or repeat.",
    outcomes: ["Set a clear goal", "Add useful context", "Review the result"],
    practice: [
      "Choose a low-risk task you can evaluate",
      "State audience, constraints, and desired format",
      "Ask KovaGPT to identify assumptions and open questions",
    ],
    safeguards: [
      "Remove private information you do not need",
      "Check facts against authoritative sources",
      "Revise the prompt when the brief is unclear",
    ],
    action: { label: "Open KovaGPT", to: "/" },
  },
  {
    slug: "healthcare",
    title: "Responsible AI workflows in healthcare",
    description:
      "Assess KovaGPT for healthcare administration and education with privacy, clinical safety, and professional oversight.",
    summary:
      "Use AI only for approved workflows and never present generated material as patient-specific diagnosis, treatment, emergency guidance, or a substitute for licensed care.",
    outcomes: [
      "Minimize sensitive data",
      "Separate education from care",
      "Preserve clinical review",
    ],
    practice: [
      "Classify the workflow and information before use",
      "Use current authoritative health sources",
      "Test ambiguous, unsafe, and urgent scenarios",
    ],
    safeguards: [
      "Do not enter protected data without authorization",
      "Escalate patient-specific questions appropriately",
      "Never delay emergency or professional care",
    ],
    action: { label: "Read health guidance", to: "/health" },
  },
  {
    slug: "how-finance-teams-use-codex",
    title: "Coding assistance for finance teams",
    description:
      "Use KovaGPT to build finance scripts and controls with reconciled fixtures, reviewable code, and change approval.",
    summary:
      "Automate a bounded calculation, reconciliation, or reporting step while preserving financial ownership, source-system controls, reproducibility, and rollback.",
    outcomes: ["Automate carefully", "Test calculations", "Control changes"],
    practice: [
      "Create anonymized fixtures with known totals",
      "Test currencies, signs, periods, and rounding",
      "Produce logs and a reversible deployment plan",
    ],
    safeguards: [
      "Keep production credentials out of generated code",
      "Require separation of duties where applicable",
      "Reconcile output before financial use",
    ],
    action: { label: "Open Code Helper", to: "/code-helper" },
  },
  {
    slug: "how-to-use-chatgpt-work-for-everyday-tasks",
    title: "Use Kova Work for everyday tasks",
    description:
      "Plan everyday research, files, analysis, and drafting in Kova Work with explicit steps and review points.",
    summary:
      "Combine a clear goal with the minimum necessary context, choose the right workspace tools, and keep progress and final evidence visible throughout the task.",
    outcomes: ["Plan the task", "Choose needed tools", "Review the handoff"],
    practice: [
      "Describe the intended deliverable and deadline",
      "Add files or sources only when they are relevant",
      "Pause at decisions that require your judgment",
    ],
    safeguards: [
      "Do not grant broader access than needed",
      "Verify external actions and important claims",
      "Stop work when required authority is missing",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "image-generation",
    title: "Generate and review images",
    description:
      "Create original images with KovaGPT using a clear visual brief, iterative review, and responsible publication checks.",
    summary:
      "Translate an audience and purpose into composition, subject, mood, palette, format, and exclusion constraints, then inspect the result before saving or publishing it.",
    outcomes: ["Write a visual brief", "Iterate deliberately", "Publish responsibly"],
    practice: [
      "Specify subject, setting, framing, style, and dimensions",
      "Change one or two visual variables per revision",
      "Inspect details, text, identity, and context",
    ],
    safeguards: [
      "Respect privacy, likeness, and intellectual property",
      "Do not present synthetic evidence as real",
      "Follow disclosure rules for the intended use",
    ],
    action: { label: "Open Images", to: "/images" },
  },
  {
    slug: "managers",
    title: "AI workflows for managers",
    description:
      "Use KovaGPT for planning, synthesis, and communication while managers retain context, fairness, and accountability.",
    summary:
      "Prepare agendas, synthesize approved material, explore options, and draft communication without delegating performance, employment, or people decisions to generated output.",
    outcomes: ["Clarify decisions", "Synthesize context", "Communicate carefully"],
    practice: [
      "State the decision, stakeholders, and constraints",
      "Separate observations from interpretations",
      "Ask for options, tradeoffs, and open questions",
    ],
    safeguards: [
      "Protect employee and confidential information",
      "Check for missing perspectives and unfair inference",
      "Keep people decisions human-owned",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "marketing",
    title: "AI workflows for marketing teams",
    description:
      "Use KovaGPT for marketing research and drafts with source checks, brand review, consent, and claim substantiation.",
    summary:
      "Move from an approved brief to research notes, message options, content drafts, and a publication checklist while keeping customer evidence and brand decisions traceable.",
    outcomes: ["Strengthen the brief", "Explore message options", "Verify claims"],
    practice: [
      "Define audience, channel, objective, and exclusions",
      "Ground research in dated, inspectable sources",
      "Review tone, accessibility, and call-to-action clarity",
    ],
    safeguards: [
      "Substantiate product and comparative claims",
      "Respect consent and communication preferences",
      "Check third-party rights before publication",
    ],
    action: { label: "Open AI Writer", to: "/ai-writer" },
  },
  {
    slug: "operations",
    title: "AI workflows for operations teams",
    description:
      "Use KovaGPT for operational analysis, procedures, and incident support with current sources and clear ownership.",
    summary:
      "Turn process information into checklists, comparisons, drafts, and improvement ideas while systems of record and authorized operators remain decisive.",
    outcomes: ["Document the process", "Find bottlenecks", "Plan reliable handoffs"],
    practice: [
      "Map inputs, owners, decisions, and exceptions",
      "Compare current and proposed process steps",
      "Test instructions with representative users",
    ],
    safeguards: [
      "Use current policies and system data",
      "Do not bypass approvals or segregation of duties",
      "Provide escalation and recovery instructions",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "personalization",
    title: "Personalize KovaGPT deliberately",
    description:
      "Tune KovaGPT instructions and preferences for useful defaults without embedding secrets or hiding important context.",
    summary:
      "Create durable preferences for tone, format, and workflow, then distinguish those defaults from task-specific facts, permissions, and current requirements.",
    outcomes: ["Set useful defaults", "Keep context current", "Review saved preferences"],
    practice: [
      "List recurring style and format preferences",
      "Separate stable preferences from temporary context",
      "Test how defaults behave on different tasks",
    ],
    safeguards: [
      "Do not store passwords or sensitive secrets",
      "Restate critical instructions in high-impact tasks",
      "Remove stale or conflicting preferences",
    ],
    action: { label: "Open KovaGPT", to: "/" },
  },
  {
    slug: "projects",
    title: "Organize sustained work in Projects",
    description:
      "Use KovaGPT Projects to keep related chats, files, instructions, and decisions organized around one outcome.",
    summary:
      "Create a durable workspace for an ongoing effort, add only relevant material, name the current objective, and keep source changes and decisions easy to review.",
    outcomes: ["Group related context", "Track the objective", "Preserve continuity"],
    practice: [
      "Name the project, owner, scope, and finish criteria",
      "Organize approved files and current instructions",
      "Summarize decisions and unresolved questions",
    ],
    safeguards: [
      "Confirm access before adding shared information",
      "Remove obsolete or unnecessary files",
      "Review project output before external use",
    ],
    action: { label: "Open Projects", to: "/projects" },
  },
  {
    slug: "research",
    title: "Research with an evidence trail",
    description:
      "Use KovaGPT to plan and synthesize research while keeping questions, sources, dates, uncertainty, and review visible.",
    summary:
      "Start with a focused question, define acceptable evidence, compare sources rather than counting them, and separate supported findings from inference and remaining gaps.",
    outcomes: ["Focus the question", "Compare evidence", "Report uncertainty"],
    practice: [
      "Set scope, date range, geography, and definitions",
      "Create inclusion and exclusion criteria for sources",
      "Map each important claim to supporting evidence",
    ],
    safeguards: [
      "Open and inspect primary sources",
      "Check dates, methods, and conflicts of interest",
      "Do not fabricate certainty when evidence is limited",
    ],
    action: { label: "Open Research Planner", to: "/research-planner" },
  },
  {
    slug: "responsible-and-safe-use",
    title: "Use AI responsibly and safely",
    description:
      "Apply KovaGPT with proportional safeguards for privacy, accuracy, fairness, security, and human accountability.",
    summary:
      "Match the workflow and review process to the possible impact, reduce unnecessary data, make limitations visible, and preserve meaningful human control.",
    outcomes: ["Assess impact", "Minimize data", "Preserve oversight"],
    practice: [
      "Identify affected people and plausible failure modes",
      "Choose controls proportionate to the consequence",
      "Create a clear escalation and correction path",
    ],
    safeguards: [
      "Do not use KovaGPT for prohibited harmful activity",
      "Test accessibility and disparate impact",
      "Keep an accountable owner for deployment",
    ],
    action: { label: "Read AI Safety", to: "/ai-safety" },
  },
  {
    slug: "sales",
    title: "AI workflows for sales teams",
    description:
      "Use KovaGPT for sales preparation and drafting with verified account facts, consent-aware outreach, and human approval.",
    summary:
      "Synthesize authorized research, prepare discovery questions, and draft tailored follow-up while pricing, commitments, recipients, and account actions remain controlled.",
    outcomes: ["Prepare useful context", "Improve discovery", "Control commitments"],
    practice: [
      "Identify reliable internal and public account sources",
      "Draft questions that test rather than assume needs",
      "Review claims, recipients, and next steps",
    ],
    safeguards: [
      "Honor consent and opt-out requirements",
      "Do not invent relationships or customer facts",
      "Confirm commercial terms with authorized owners",
    ],
    action: { label: "Open Work", to: "/work" },
  },
  {
    slug: "search-and-deep-research",
    title: "Choose between quick search and deep research",
    description:
      "Select the right KovaGPT research depth for the question, evidence standard, time available, and consequence of error.",
    summary:
      "Use focused lookup for narrow current facts and a planned multi-source workflow for questions that need comparison, synthesis, conflict resolution, or a durable report.",
    outcomes: ["Match depth to need", "Inspect sources", "Know when to stop"],
    practice: [
      "Define the decision the research must support",
      "Set source, freshness, and coverage requirements",
      "Review citations and unresolved contradictions",
    ],
    safeguards: [
      "Do not equate more sources with stronger evidence",
      "Check that citations support nearby claims",
      "Escalate high-impact conclusions for qualified review",
    ],
    action: { label: "Open Research Planner", to: "/research-planner" },
  },
  {
    slug: "skills",
    title: "Turn repeated work into reusable skills",
    description:
      "Design reusable KovaGPT skills with a narrow trigger, owned instructions, test cases, and maintained resources.",
    summary:
      "Package a proven workflow only after its inputs, outputs, permissions, failure behavior, and review requirements are understood and reproducible.",
    outcomes: ["Capture a proven workflow", "Define clear triggers", "Maintain the package"],
    practice: [
      "Write the purpose, trigger, inputs, and non-goals",
      "Reuse approved templates and scripts",
      "Test success, ambiguity, and failure cases",
    ],
    safeguards: [
      "Keep secrets and personal data out of skill files",
      "Require confirmation for consequential actions",
      "Version and retire outdated instructions",
    ],
    action: { label: "Explore Kova workflows", to: "/use-cases" },
  },
  {
    slug: "using-chatgpt",
    title: "Use KovaGPT effectively",
    description:
      "Learn the core KovaGPT loop: describe the outcome, provide context, inspect the draft, and refine with evidence.",
    summary:
      "Treat the conversation as a working session where you can clarify constraints, request structure, challenge assumptions, and keep important source material close.",
    outcomes: ["Describe the outcome", "Iterate with purpose", "Verify important output"],
    practice: [
      "Lead with audience, goal, constraints, and format",
      "Ask KovaGPT to expose assumptions and questions",
      "Use follow-ups to critique and improve the draft",
    ],
    safeguards: [
      "Share only context you are permitted to use",
      "Check changing facts and cited material",
      "Keep final judgment with the responsible person",
    ],
    action: { label: "Open KovaGPT", to: "/" },
  },
  {
    slug: "what-is-ai",
    title: "What generative AI can and cannot do",
    description:
      "Understand generative AI as pattern-based software that can create useful drafts but does not guarantee truth or judgment.",
    summary:
      "Learn why fluent output can still be incomplete or wrong, how context shapes a response, and why evidence and human responsibility remain necessary.",
    outcomes: ["Understand generation", "Recognize uncertainty", "Use appropriate review"],
    practice: [
      "Compare recall, reasoning, retrieval, and tool use",
      "Observe how constraints change an answer",
      "Test a response against a known reference",
    ],
    safeguards: [
      "Do not anthropomorphize model confidence",
      "Separate generated content from verified action",
      "Match review effort to possible harm",
    ],
    action: { label: "Start with KovaGPT", to: "/" },
  },
  {
    slug: "working-with-files",
    title: "Work with files while keeping the source visible",
    description:
      "Use supported files with KovaGPT for extraction, comparison, and drafting while checking the original document.",
    summary:
      "Ask focused questions against approved files, distinguish quoted or extracted material from interpretation, and verify layouts, tables, scans, and footnotes manually.",
    outcomes: ["Ask focused questions", "Trace answers to sources", "Check extraction limits"],
    practice: [
      "Name the documents, purpose, and expected format",
      "Request locations for important findings",
      "Compare conflicting passages and versions",
    ],
    safeguards: [
      "Remove unnecessary private information",
      "Do not assume every visual element was extracted",
      "Verify consequential conclusions in the original",
    ],
    action: { label: "Open Files", to: "/files" },
  },
  {
    slug: "workspace-agents",
    title: "Design agents for a shared workspace",
    description:
      "Create bounded Kova workspace agents with explicit roles, permissions, confirmations, monitoring, and accountable owners.",
    summary:
      "Assign a narrow workflow to an agent only after the allowed tools, data, targets, costs, stopping conditions, and human handoffs are documented and tested.",
    outcomes: ["Define the execution envelope", "Limit permissions", "Observe every action"],
    practice: [
      "List allowed tools, inputs, outputs, and targets",
      "Mark actions that always require confirmation",
      "Test interruption, retries, and partial failure",
    ],
    safeguards: [
      "Use least-privilege account connections",
      "Retain evidence of external changes",
      "Provide clear cancellation and recovery paths",
    ],
    action: { label: "Browse assistants", to: "/assistants" },
  },
  {
    slug: "writing",
    title: "Write with a clear brief and review loop",
    description:
      "Use KovaGPT for planning, drafting, editing, and adaptation while preserving facts, voice, attribution, and ownership.",
    summary:
      "Turn audience, purpose, evidence, tone, structure, and exclusions into a useful draft, then revise deliberately instead of accepting fluent text as finished work.",
    outcomes: ["Strengthen the brief", "Draft in stages", "Preserve attribution"],
    practice: [
      "State audience, purpose, tone, length, and format",
      "Mark facts, quotations, and terms that must not change",
      "Review structure, clarity, evidence, and voice separately",
    ],
    safeguards: [
      "Check facts, citations, and quoted wording",
      "Respect confidentiality and intellectual property",
      "Follow disclosure and publication rules",
    ],
    action: { label: "Open AI Writer", to: "/ai-writer" },
  },
];

export const PUBLIC_ACADEMY_PAGES: readonly PublicDetailPage[] = topics.map(academy);

export const PUBLIC_ACADEMY_PAGE_BY_KEY = new Map(
  PUBLIC_ACADEMY_PAGES.map((item) => [`${item.section}/${item.slug}`, item]),
);
