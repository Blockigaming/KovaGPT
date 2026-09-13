export type PublicPage = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  summary: string;
  sections: { title: string; body: string }[];
  review?: "legal" | "admin";
};

const page = (
  slug: string,
  title: string,
  eyebrow: string,
  description: string,
  summary: string,
  sections: PublicPage["sections"],
  review?: PublicPage["review"],
): PublicPage => ({ slug, title, eyebrow, description, summary, sections, review });

export const PUBLIC_PAGES: readonly PublicPage[] = [
  page(
    "chat",
    "Chat with KovaGPT",
    "Product",
    "Learn how KovaGPT supports focused, source-aware conversations.",
    "Start a conversation, add supported context, and choose the tools appropriate to your task.",
    [
      {
        title: "A workspace, not a promise",
        body: "KovaGPT can draft, explain, compare, and organize. Outputs can be incomplete or wrong, so verify important work against primary sources.",
      },
      {
        title: "Your controls",
        body: "Temporary chats, memory preferences, exports, and deletion controls are available according to account and deployment configuration.",
      },
    ],
  ),
  page(
    "features",
    "KovaGPT features",
    "Product",
    "Explore the chat, files, research, images, projects, and scheduling capabilities available in KovaGPT.",
    "One workspace brings together supported AI tools without pretending every capability is available to every account.",
    [
      {
        title: "Create and analyze",
        body: "Work with text, supported files, images, and structured project context.",
      },
      {
        title: "Stay in control",
        body: "Plan limits and server capability checks determine which tools can run.",
      },
    ],
  ),
  page(
    "plans",
    "Plans for different ways of working",
    "Plans",
    "Compare KovaGPT guest, individual, and organization experiences.",
    "Choose based on the capabilities you need. Current availability and authoritative prices are shown at checkout.",
    [
      {
        title: "Individuals",
        body: "Guest and paid experiences differ in history, limits, models, and tools.",
      },
      {
        title: "Organizations",
        body: "Contact KovaGPT to discuss deployment needs; no certification or feature is implied before agreement.",
      },
    ],
  ),
  page(
    "business",
    "KovaGPT for business",
    "Organizations",
    "Explore truthful deployment options for teams evaluating KovaGPT.",
    "Evaluate KovaGPT around your data boundaries, workflows, and required controls.",
    [
      {
        title: "Start with requirements",
        body: "We document needed access, retention, and administrative controls before describing a deployment as ready.",
      },
      {
        title: "No invented assurances",
        body: "Security and compliance claims require evidence and contract review.",
      },
    ],
  ),
  page(
    "enterprise",
    "Enterprise evaluation",
    "Organizations",
    "Evaluate KovaGPT for enterprise requirements without unsupported claims.",
    "Bring identity, retention, security, procurement, and support requirements to a scoped evaluation.",
    [
      {
        title: "Deployment review",
        body: "Availability depends on the configured Azure, identity, storage, and provider environment.",
      },
      {
        title: "Contract first",
        body: "Enterprise capabilities are not represented as operational until technically and contractually verified.",
      },
    ],
  ),
  page(
    "education",
    "KovaGPT for learning",
    "Education",
    "Use KovaGPT as a learning aid while keeping educators and source material central.",
    "Draft study plans, explain concepts, and organize notes—then check every important claim.",
    [
      {
        title: "Support understanding",
        body: "Ask for explanations, practice questions, and comparisons rather than unreviewed final work.",
      },
      {
        title: "Academic integrity",
        body: "Follow your institution's rules and disclose AI assistance when required.",
      },
    ],
  ),
  page(
    "families",
    "KovaGPT for families",
    "Families",
    "Review family-oriented safety guidance and account boundaries for KovaGPT.",
    "KovaGPT is not a substitute for adult supervision, professional advice, or age-appropriate safeguards.",
    [
      {
        title: "Set expectations",
        body: "Discuss what information should never be shared and verify generated answers together.",
      },
      {
        title: "Safety decisions",
        body: "Family or parental controls are only described as available when server enforcement exists.",
      },
    ],
  ),
  page(
    "developers",
    "Build with KovaGPT",
    "Developers",
    "Developer documentation for the KovaGPT API and supported integration surfaces.",
    "Use server-issued credentials, follow published limits, and design for streamed output and recoverable errors.",
    [
      {
        title: "Start safely",
        body: "Keep API credentials on your server and separate development from production.",
      },
      {
        title: "Authoritative billing",
        body: "Prices and availability come from the approved server catalog and margin-protected quote flow.",
      },
    ],
  ),
  page(
    "use-cases",
    "Ways to use KovaGPT",
    "Use cases",
    "Explore practical, truthful KovaGPT workflows across writing, learning, research, coding, and files.",
    "Choose a workflow, provide context, and keep human review in the loop.",
    [
      { title: "Draft and refine", body: "Turn rough material into a reviewable first draft." },
      {
        title: "Investigate and compare",
        body: "Use citations where available and open the underlying source.",
      },
    ],
  ),
  page(
    "learn",
    "Learn KovaGPT",
    "Guides",
    "Practical guidance for using KovaGPT responsibly and effectively.",
    "Learn how to prompt, verify, manage context, and recover from common errors.",
    [
      {
        title: "Give useful context",
        body: "State the audience, constraints, desired format, and source boundaries.",
      },
      {
        title: "Verify",
        body: "Check time-sensitive, financial, legal, medical, and safety-critical output independently.",
      },
    ],
  ),
  page(
    "shopping-assistant",
    "Shopping research assistance",
    "Use case",
    "Compare products with KovaGPT without hidden endorsements or fabricated prices.",
    "Organize requirements and compare options, then verify availability, price, warranty, and seller terms directly.",
    [
      {
        title: "Define criteria",
        body: "Separate must-have requirements from preferences and budget.",
      },
      {
        title: "Check the seller",
        body: "KovaGPT does not guarantee listings, fulfillment, or suitability.",
      },
    ],
  ),
  page(
    "translation",
    "Translation assistance",
    "Use case",
    "Draft translations with KovaGPT and preserve context for human review.",
    "Translate supplied text across supported model languages, with extra review for legal, medical, or culturally sensitive material.",
    [
      {
        title: "Preserve intent",
        body: "Provide audience, locale, tone, and terminology constraints.",
      },
      {
        title: "Review nuance",
        body: "Machine output can miss idiom, ambiguity, or regional usage.",
      },
    ],
  ),
  page(
    "document-analysis",
    "Document and file analysis",
    "Use case",
    "Analyze supported files with KovaGPT while respecting extraction limits.",
    "Upload supported material, ask focused questions, and compare results with the original document.",
    [
      {
        title: "Extraction has limits",
        body: "Scans, tables, footnotes, formatting, and embedded media may be missed.",
      },
      {
        title: "Keep originals",
        body: "Citations and summaries should be verified against the source file.",
      },
    ],
  ),
  page(
    "about",
    "About KovaGPT",
    "Company",
    "Learn what KovaGPT is and how the product is developed.",
    "KovaGPT is an independent AI workspace designed around useful workflows, truthful capability boundaries, and user control.",
    [
      {
        title: "Our approach",
        body: "We prefer a clear unavailable state over pretending an integration works.",
      },
      {
        title: "Independent product",
        body: "KovaGPT is not OpenAI and is not represented as an official ChatGPT product.",
      },
    ],
  ),
  page(
    "mission",
    "Our mission",
    "Company",
    "Read KovaGPT's product mission and operating principles.",
    "Make capable AI workflows understandable, controllable, and honest about their limits.",
    [
      {
        title: "Useful by design",
        body: "Shared systems should make common work faster without hiding uncertainty.",
      },
      {
        title: "Trust through evidence",
        body: "Claims about security, integrations, and performance require current evidence.",
      },
    ],
  ),
  page(
    "leadership",
    "Leadership information",
    "Company",
    "KovaGPT leadership information pending verified publication.",
    "No founder, executive, or biography is published here until ownership and wording are approved.",
    [
      {
        title: "Verification required",
        body: "This page intentionally does not invent people, roles, credentials, or biographies.",
      },
    ],
    "admin",
  ),
  page(
    "press",
    "Press resources",
    "Company",
    "Verified KovaGPT facts and contact guidance for press inquiries.",
    "Use the product name KovaGPT and contact the team before publishing claims about availability or relationships.",
    [
      {
        title: "Fact checking",
        body: "Product details can change; request current confirmation for material claims.",
      },
      {
        title: "Assets",
        body: "Only Kova-owned marks supplied through approved brand resources may be used.",
      },
    ],
  ),
  page(
    "brand",
    "KovaGPT brand resources",
    "Company",
    "Guidance for accurate references to KovaGPT.",
    "Use KovaGPT's name accurately and do not imply endorsement, partnership, or affiliation.",
    [
      { title: "Name", body: "Write KovaGPT with that capitalization." },
      {
        title: "Permission",
        body: "No downloadable partner or certification marks are offered without an approved license.",
      },
    ],
  ),
  page(
    "careers",
    "Careers and future opportunities",
    "Company",
    "Learn how future KovaGPT opportunities will be published.",
    "There are no job openings represented on this page. Verified openings may be added through an approved hiring system.",
    [
      {
        title: "No speculative listings",
        body: "KovaGPT does not collect applications for roles that have not been approved.",
      },
    ],
    "admin",
  ),
  page(
    "partners",
    "Partners and integrations",
    "Company",
    "Understand how KovaGPT describes verified providers and integrations.",
    "An integration appears as working only after its authorization and tools operate end to end.",
    [
      {
        title: "Verified relationships only",
        body: "Technology use does not automatically imply a commercial endorsement or partnership.",
      },
    ],
    "admin",
  ),
  page(
    "customer-stories",
    "Customer stories",
    "Company",
    "Approved KovaGPT customer stories will appear here.",
    "No customer name, quote, outcome, or logo is published without documented approval.",
    [
      {
        title: "No fabricated proof",
        body: "This intentionally empty index waits for real, approved material.",
      },
    ],
    "admin",
  ),
  page(
    "cookie-policy",
    "Cookie policy",
    "Legal",
    "Review how KovaGPT uses browser storage and cookies.",
    "KovaGPT uses storage required for sessions, security, preferences, and configured product functionality.",
    [
      {
        title: "Required storage",
        body: "Authentication and security mechanisms may require cookies or equivalent browser storage.",
      },
      {
        title: "Review status",
        body: "Deployment-specific vendors and retention must be reviewed before production publication.",
      },
    ],
    "legal",
  ),
  page(
    "acceptable-use",
    "Acceptable use policy",
    "Legal",
    "Rules for safe and lawful use of KovaGPT.",
    "Do not use KovaGPT to harm people, violate rights, evade safeguards, or access data without authorization.",
    [
      {
        title: "Protect people and systems",
        body: "Malware, fraud, abuse, exploitation, and unauthorized surveillance are prohibited.",
      },
      {
        title: "Enforcement",
        body: "Controls and remedies depend on applicable terms and server policy.",
      },
    ],
    "legal",
  ),
  page(
    "security",
    "KovaGPT security",
    "Trust",
    "Learn about KovaGPT's security approach without unsupported certification claims.",
    "KovaGPT applies layered application controls and documents deployment-specific verification separately.",
    [
      {
        title: "Application controls",
        body: "Authorization, ownership checks, bounded inputs, and protected secrets are part of the architecture.",
      },
      {
        title: "No blanket guarantee",
        body: "No system is risk free, and this page does not claim an unverified certification.",
      },
    ],
  ),
  page(
    "responsible-disclosure",
    "Responsible disclosure",
    "Security",
    "Report a potential KovaGPT security issue responsibly.",
    "Do not access unrelated data, disrupt services, or publish sensitive details while a report is being assessed.",
    [
      {
        title: "What to include",
        body: "Provide reproducible steps, impact, affected route, and a safe proof of concept.",
      },
      {
        title: "No bounty promise",
        body: "This page does not promise payment or safe-harbor terms beyond an approved policy.",
      },
    ],
    "legal",
  ),
  page(
    "trust",
    "KovaGPT trust center",
    "Trust",
    "Find KovaGPT privacy, safety, security, and operational documentation.",
    "Use this hub to distinguish implemented controls from roadmap items and deployment-specific evidence.",
    [
      {
        title: "Evidence over badges",
        body: "KovaGPT does not display certifications that have not been verified.",
      },
      { title: "Current status", body: "Operational availability belongs on the status page." },
    ],
  ),
  page(
    "transparency",
    "Transparency",
    "Trust",
    "Understand KovaGPT capability, moderation, and disclosure principles.",
    "KovaGPT documents meaningful limitations, external dependencies, and intentional product exclusions.",
    [
      {
        title: "Capability boundaries",
        body: "Unavailable providers and plan-gated tools are not presented as active.",
      },
      {
        title: "Requests and reports",
        body: "Formal reporting metrics require verified operational data before publication.",
      },
    ],
  ),
  page(
    "model-behavior",
    "Model behavior",
    "Trust",
    "Understand common AI model behaviors and limitations in KovaGPT.",
    "Generated output may be incorrect, biased, incomplete, or inconsistent, even when it sounds confident.",
    [
      {
        title: "Tool boundaries",
        body: "A model can only use tools that the server authorizes for the current request.",
      },
      {
        title: "Human judgment",
        body: "High-impact decisions need qualified review and primary evidence.",
      },
    ],
  ),
  page(
    "moderation",
    "Moderation approach",
    "Safety",
    "How KovaGPT handles reports and safety boundaries.",
    "KovaGPT combines provider safeguards, application policy, user reports, and administrative review where configured.",
    [
      {
        title: "Report responsibly",
        body: "Include enough context for review without sharing unnecessary sensitive information.",
      },
      {
        title: "No universal detection claim",
        body: "Automated systems can miss harmful content or make mistakes.",
      },
    ],
  ),
  page(
    "data-controls",
    "Data controls",
    "Privacy",
    "Understand KovaGPT controls for history, memory, export, and deletion.",
    "Account and device controls are surfaced only where the corresponding server or scoped storage behavior exists.",
    [
      {
        title: "Account data",
        body: "Signed-in data is subject to authenticated ownership checks and configured storage policy.",
      },
      {
        title: "Device data",
        body: "Some guest preferences and history can be held in browser storage and cleared on that device.",
      },
    ],
  ),
  page(
    "accessibility",
    "Accessibility at KovaGPT",
    "Accessibility",
    "KovaGPT's approach to keyboard, screen-reader, motion, and responsive access.",
    "KovaGPT aims for operable controls, meaningful names, visible focus, reduced motion, and layouts that work from small screens upward.",
    [
      {
        title: "Known limitations",
        body: "Report the route, browser, assistive technology, and steps when something is not usable.",
      },
      {
        title: "Continuous verification",
        body: "Automated checks support—but do not replace—testing with people and assistive technologies.",
      },
    ],
  ),
  page(
    "overview",
    "Meet KovaGPT",
    "Product overview",
    "Explore KovaGPT chat, research, images, files, projects, apps, and workspaces.",
    "KovaGPT brings focused AI workflows into one workspace with explicit limits, account controls, and provider-aware availability.",
    [
      {
        title: "Start with conversation",
        body: "Draft, explain, compare, and plan in chat, then move longer work into Projects, Library, Study, Research, Images, or Work.",
      },
      {
        title: "Know what is real",
        body: "Plan eligibility, server authorization, provider readiness, and privacy mode determine what can run. Unavailable tools stay visibly unavailable.",
      },
    ],
  ),
  page(
    "college-students",
    "KovaGPT for college students",
    "Education",
    "Use KovaGPT for explanation, practice, research planning, and organization while following course rules.",
    "Build understanding with guided questions and reviewable drafts—not unchecked answers submitted as your own work.",
    [
      {
        title: "Learn actively",
        body: "Set a learning objective, attempt the problem first, ask for targeted hints, and explain the final reasoning in your own words.",
      },
      {
        title: "Protect your work",
        body: "Do not upload unnecessary personal, institutional, research, or participant data. Cite sources and disclose AI assistance when required.",
      },
    ],
  ),
  page(
    "parent-resources",
    "Resources for parents and caregivers",
    "Families",
    "Practical guidance for discussing AI limits, privacy, safety, and verification with young people.",
    "Set clear expectations about what information to share, what claims to verify, and when a trusted adult or qualified professional needs to step in.",
    [
      {
        title: "Use AI together",
        body: "Review generated answers, ask where facts came from, and compare important claims with trusted age-appropriate sources.",
      },
      {
        title: "Set boundaries",
        body: "Avoid sharing sensitive identifiers, private school records, health details, or information about other people that is not needed.",
      },
    ],
  ),
  page(
    "health",
    "Health information with clear boundaries",
    "Safety",
    "Use KovaGPT to organize general health questions without treating it as diagnosis, treatment, or emergency care.",
    "Generated health information can be incomplete, outdated, or wrong. A qualified clinician and authoritative guidance remain the source for medical decisions.",
    [
      {
        title: "Prepare better questions",
        body: "Organize symptoms, timing, medication questions, or appointment notes, then review them with a qualified professional.",
      },
      {
        title: "Know when not to wait",
        body: "For urgent symptoms, danger, or crisis, contact local emergency or crisis services rather than relying on an AI response.",
      },
    ],
  ),
  page(
    "contact-sales",
    "Talk with KovaGPT about your organization",
    "Contact",
    "Discuss organizational requirements without assuming features, certifications, pricing, or deployment terms.",
    "Share the workflow, users, data boundaries, identity needs, review requirements, and deployment constraints you need evaluated.",
    [
      {
        title: "Bring requirements",
        body: "Describe the use case, expected scale, sensitive data classes, access model, retention needs, and required integrations.",
      },
      {
        title: "Confirm before relying",
        body: "Availability, support, security commitments, commercial terms, and implementation timing are confirmed in writing before purchase.",
      },
    ],
  ),
  page(
    "shopping",
    "Shopping research with KovaGPT",
    "Use case",
    "Compare products and tradeoffs without implying live inventory, fulfillment, endorsement, or guaranteed prices.",
    "Turn needs into criteria, compare supported evidence, and verify the final price, seller, warranty, availability, and return terms directly.",
    [
      {
        title: "Compare what matters",
        body: "Separate must-haves from preferences, set a budget, and ask for explicit tradeoffs instead of a single unexplained recommendation.",
      },
      {
        title: "Check before buying",
        body: "Listings and prices change. Confirm product identity, merchant reputation, shipping, warranty, compatibility, and return policy at the seller.",
      },
    ],
  ),
  page(
    "codex",
    "Coding with KovaGPT",
    "Coding",
    "Use KovaGPT to plan, explain, review, and test code with repository and human-review boundaries.",
    "KovaGPT supports coding workflows through chat, files, GitHub authorization, and reviewable outputs without claiming autonomous or unrestricted repository control.",
    [
      {
        title: "Work from real context",
        body: "Provide the relevant code, runtime, constraints, failing behavior, and expected outcome. Connect GitHub only when the intended repository and scopes are clear.",
      },
      {
        title: "Verify every change",
        body: "Run tests, static checks, security review, and human code review before merging or deploying generated changes.",
      },
    ],
  ),
  page(
    "gpts",
    "KovaGPT assistants",
    "Assistants",
    "Browse KovaGPT assistants without copying third-party GPT listings or user-generated content.",
    "KovaGPT's assistant directory contains Kova-owned or explicitly published assistant configurations with clear capability and ownership boundaries.",
    [
      {
        title: "Published assistants only",
        body: "An assistant appears when its configuration is available through KovaGPT. External names, instructions, files, conversations, ratings, and creator content are not imported without authorization.",
      },
      {
        title: "Review before use",
        body: "Check an assistant's description, tools, data needs, and limitations. Generated output still requires verification appropriate to the task.",
      },
    ],
  ),
  page(
    "download",
    "Use KovaGPT on the web",
    "Access",
    "Open KovaGPT in a supported browser; no native desktop or mobile download is currently published.",
    "KovaGPT is currently delivered as a web application. This page avoids presenting an installer, app-store badge, or download that does not exist.",
    [
      {
        title: "Current access",
        body: "Use the web application and your browser's supported install or shortcut features where available. Browser-created shortcuts are not native KovaGPT applications.",
      },
      {
        title: "Verify future downloads",
        body: "Any future native client must be published through a verified KovaGPT channel with platform, signing, update, privacy, and support details.",
      },
    ],
  ),
  page(
    "import-to-chatgpt",
    "Bring content into KovaGPT",
    "Import guidance",
    "Move supported content into KovaGPT without implying direct access to another service or account.",
    "KovaGPT can work with text you provide and supported files you upload. It does not claim a direct ChatGPT account-import connection.",
    [
      {
        title: "Use supported inputs",
        body: "Copy only content you are authorized to use or upload supported files through KovaGPT's file workflow. Keep originals until you verify the result.",
      },
      {
        title: "Protect private data",
        body: "Review exports before upload, remove unnecessary personal information, and do not assume histories, settings, memories, or account metadata transfer automatically.",
      },
    ],
  ),
  page(
    "merchants",
    "Merchant integration status",
    "Shopping",
    "Understand KovaGPT's shopping-research boundary without an unavailable merchant onboarding flow.",
    "KovaGPT does not currently offer merchant enrollment, catalog ingestion, sponsored placement, checkout, or fulfillment services.",
    [
      {
        title: "No merchant onboarding",
        body: "This page does not collect feeds, credentials, commercial terms, inventory, or payment details because those operational systems are not available.",
      },
      {
        title: "Shopping remains research",
        body: "Users can organize requirements and compare evidence, then verify price, availability, seller identity, warranty, and return terms directly.",
      },
    ],
  ),
  page(
    "remote",
    "Remote work with KovaGPT",
    "Work",
    "Plan and review remote knowledge-work tasks while keeping access, execution, and approval boundaries explicit.",
    "KovaGPT can help organize work and, where configured, use bounded tools. It does not imply unattended access to a computer, network, repository, or account.",
    [
      {
        title: "Define the boundary",
        body: "State the goal, allowed systems, credentials, time limit, expected output, and actions that require confirmation before work begins.",
      },
      {
        title: "Review consequential actions",
        body: "Inspect generated artifacts, tool output, external messages, code changes, purchases, and account changes before they take effect.",
      },
    ],
  ),
  page(
    "voice",
    "Voice availability in KovaGPT",
    "Feature availability",
    "Voice conversation is not currently an available KovaGPT capability.",
    "KovaGPT keeps voice controls absent until microphone permission, recording state, interruption, playback, retention, privacy, accessibility, and end-to-end behavior are ready.",
    [
      {
        title: "No recording from this page",
        body: "KovaGPT does not request microphone permission or begin audio capture here. Use text and supported file inputs for current workflows.",
      },
      {
        title: "Readiness before release",
        body: "A future voice experience requires visible start and stop controls, clear recording indicators, text alternatives, data disclosures, and verified recovery behavior.",
      },
    ],
  ),
  page(
    "copyright",
    "Copyright requests",
    "Legal",
    "How to send a copyright-related request concerning KovaGPT content.",
    "Provide identification, the material or location at issue, your authority, and a reliable way to respond.",
    [
      { title: "Accurate notices", body: "Do not submit knowingly false or misleading notices." },
      {
        title: "Legal review",
        body: "Process details and jurisdiction-specific language require counsel approval.",
      },
    ],
    "legal",
  ),
  page(
    "regional-notices",
    "Regional privacy notices",
    "Legal",
    "Regional KovaGPT notices pending legal and deployment review.",
    "Applicable rights and disclosures depend on location, entity, deployment, and data practices.",
    [
      {
        title: "Human review required",
        body: "This page does not invent region-specific rights, contacts, or effective dates.",
      },
    ],
    "legal",
  ),
  page(
    "developer-terms",
    "Developer terms and policies",
    "Legal",
    "Terms governing KovaGPT developer surfaces pending legal review.",
    "API access remains subject to authentication, published limits, applicable terms, and server-side billing enforcement.",
    [
      {
        title: "No pricing override",
        body: "Clients cannot bypass server entitlements or the approved margin-protected quote flow.",
      },
    ],
    "legal",
  ),
];

export const PUBLIC_PAGE_BY_SLUG = new Map(PUBLIC_PAGES.map((item) => [item.slug, item]));
