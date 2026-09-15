import type { PublicPage } from "./public-content";

const page = (
  slug: string,
  title: string,
  eyebrow: string,
  description: string,
  summary: string,
  sections: PublicPage["sections"],
): PublicPage => ({ slug, title, eyebrow, description, summary, sections });

export const EXPANDED_PUBLIC_PAGES: readonly PublicPage[] = [
  page(
    "academy",
    "KovaGPT Academy",
    "Learning hub",
    "Build practical AI skills with original KovaGPT guidance and responsible-use boundaries.",
    "Start with the product basics, practice on low-risk work, and learn how to verify output before using AI in consequential workflows.",
    [
      {
        title: "Learn by doing",
        body: "Begin with a clear task, provide only necessary context, compare the result with your source material, and revise with specific feedback.",
      },
      {
        title: "Use judgment",
        body: "Treat generated content as a draft. Sensitive, regulated, financial, legal, medical, and safety-critical decisions need qualified review.",
      },
      {
        title: "Respect data boundaries",
        body: "Do not upload secrets or personal information that the task does not require. Follow your organization's approved tools and retention rules.",
      },
    ],
  ),
  page(
    "business-data",
    "Business data in KovaGPT",
    "Data controls",
    "Understand how organizational data should be scoped, authorized, retained, and reviewed in KovaGPT workflows.",
    "KovaGPT does not treat access to business data as permission to reuse it. Deployment, connector, retention, and model-provider behavior must be evaluated for the configured environment.",
    [
      {
        title: "Minimum necessary access",
        body: "Connect only the sources needed for the task, use the narrowest available scopes, and keep credentials on approved server-side boundaries.",
      },
      {
        title: "Ownership and review",
        body: "Workspace authorization and source-system permissions remain authoritative. Generated summaries and transformations still require owner review.",
      },
      {
        title: "Deployment-specific evidence",
        body: "Retention, residency, provider processing, and contractual commitments are not inferred from this page; confirm them for the actual deployment.",
      },
    ],
  ),
  page(
    "charter",
    "KovaGPT operating charter",
    "Company",
    "The principles used to decide what KovaGPT builds, exposes, and claims.",
    "KovaGPT prioritizes useful human-controlled workflows, evidence-backed product claims, privacy-aware defaults, and visible limitations.",
    [
      {
        title: "Truth before appearance",
        body: "An unavailable state is better than a control that suggests an integration, entitlement, or safeguard works when it does not.",
      },
      {
        title: "People retain agency",
        body: "Users should understand when tools act, what data is used, and which consequential steps require confirmation or independent review.",
      },
      {
        title: "Evidence stays current",
        body: "Security, performance, pricing, availability, and compliance statements must be tied to current technical or contractual evidence.",
      },
    ],
  ),
  page(
    "consumer-privacy",
    "Consumer privacy at KovaGPT",
    "Privacy",
    "A plain-language guide to KovaGPT history, memory, export, deletion, and device-level controls.",
    "Use the product's data controls to manage supported account information. Exact processing, retention, and provider behavior depend on the deployed service and applicable notices.",
    [
      {
        title: "Know where data lives",
        body: "Signed-in records, provider requests, uploaded files, and device-held preferences can follow different storage and retention paths.",
      },
      {
        title: "Use available controls",
        body: "History, memory preferences, temporary modes, export, and deletion are shown only where their corresponding behavior is implemented.",
      },
      {
        title: "Share less",
        body: "Remove unnecessary identifiers and sensitive details before sending a prompt or file, especially when a lower-risk version can answer the question.",
      },
    ],
  ),
  page(
    "economic-research-exchange",
    "Economic research exchange status",
    "Research program",
    "KovaGPT does not currently operate an application-based economic research exchange.",
    "This page records the unavailable state instead of collecting proposals, affiliations, research data, or participant information for a program that has not been established.",
    [
      {
        title: "No open call",
        body: "There is no active application, grant, fellowship, dataset-access, publication, or event commitment associated with KovaGPT here.",
      },
      {
        title: "Publication requirements",
        body: "A future program would need approved eligibility, review, privacy, conflicts, data-use, attribution, funding, and contact terms before accepting submissions.",
      },
    ],
  ),
  page(
    "enterprise-privacy",
    "Enterprise privacy at KovaGPT",
    "Organizations",
    "Evaluate identity, access, retention, provider processing, and administrative controls for an organizational KovaGPT deployment.",
    "No enterprise privacy or compliance commitment is created by this page. Required controls and terms must be verified against the configured environment and written agreement.",
    [
      {
        title: "Map the data path",
        body: "Document inputs, connectors, model providers, storage, logs, exports, administrators, subprocessors, and deletion behavior for the intended workflow.",
      },
      {
        title: "Enforce access",
        body: "Use verified identity and ownership controls, least-privilege connectors, tenant boundaries, and auditable administrative actions.",
      },
      {
        title: "Confirm commitments",
        body: "Residency, retention, training use, support, certifications, breach terms, and legal obligations require deployment-specific evidence and contracts.",
      },
    ],
  ),
  page(
    "interview-guide",
    "KovaGPT interview guide status",
    "Careers",
    "What candidates can expect if KovaGPT publishes an approved role and interview process.",
    "KovaGPT has no represented openings or active interview process on this page. Future candidates should rely only on a verified role listing and direct KovaGPT communication.",
    [
      {
        title: "Verify the role",
        body: "Do not send identity documents, financial information, credentials, or unpaid work in response to an unverified message or listing.",
      },
      {
        title: "Accessible process",
        body: "A future process should explain stages, evaluation criteria, accommodations, timing, contacts, and permitted use of AI tools before assessment.",
      },
    ],
  ),
  page(
    "open-model-feedback",
    "Open-model feedback status",
    "Models",
    "KovaGPT does not currently distribute an open-weight model or collect model-specific feedback through this page.",
    "Use product support for reproducible KovaGPT issues. A future model-feedback program would identify the exact artifact, license, versions, accepted reports, privacy terms, and response process.",
    [
      {
        title: "No model upload",
        body: "This page does not request weights, datasets, exploit material, personal information, or confidential evaluation results.",
      },
      {
        title: "Useful product reports",
        body: "For a KovaGPT behavior issue, include the affected route, safe reproduction steps, expected behavior, actual behavior, and non-sensitive environment details.",
      },
    ],
  ),
  page(
    "open-models",
    "Open models and KovaGPT",
    "Models",
    "Understand the difference between KovaGPT, configured model providers, and downloadable open-weight models.",
    "KovaGPT is an application and does not claim that every model it can access is open source or available for download. Model availability and terms come from the configured provider.",
    [
      {
        title: "Check the artifact",
        body: "A valid open-model release should identify weights, code, license, version, provenance, integrity information, intended uses, and known limitations.",
      },
      {
        title: "Provider terms still apply",
        body: "Hosted models may have separate access, acceptable-use, privacy, geographic, and commercial terms even when related artifacts are publicly available.",
      },
      {
        title: "No implied release",
        body: "KovaGPT does not offer model weights from this page and does not relabel third-party models as Kova-owned releases.",
      },
    ],
  ),
  page(
    "our-structure",
    "How KovaGPT is structured",
    "Company",
    "A truthful boundary between the KovaGPT product, its operators, and external technology providers.",
    "KovaGPT is an independent product. It is not OpenAI, ChatGPT, or an official product of a model, cloud, payment, or connector provider.",
    [
      {
        title: "Product responsibility",
        body: "KovaGPT owns its application experience and must accurately describe which server, provider, storage, payment, and integration behavior is active.",
      },
      {
        title: "External services",
        body: "Using a vendor's technology does not by itself create an endorsement, corporate affiliation, joint product, or guarantee from that vendor.",
      },
      {
        title: "Verified company details",
        body: "Legal entity, leadership, address, and governance details are published only after owner approval rather than inferred or invented.",
      },
    ],
  ),
  page(
    "policies",
    "KovaGPT policies",
    "Policy center",
    "Find the rules and notices that govern use of KovaGPT and its supported developer surfaces.",
    "Product behavior, privacy notices, terms, acceptable use, copyright, disclosure, and developer requirements should be read together with deployment-specific information.",
    [
      {
        title: "Product and privacy",
        body: "Review the terms, privacy information, data controls, refund policy, and applicable regional notices before relying on the service.",
      },
      {
        title: "Safety and rights",
        body: "Acceptable-use, moderation, copyright, and responsible-disclosure guidance protect people, systems, intellectual property, and authorized access.",
      },
      {
        title: "Developer obligations",
        body: "Keep credentials server-side, follow published limits and billing, and do not use client code to bypass authorization or entitlements.",
      },
    ],
  ),
  page(
    "residency",
    "KovaGPT residency program status",
    "Careers",
    "KovaGPT does not currently operate or accept applications for a residency program.",
    "This page provides a clear unavailable state so visitors are not asked for applications, references, work samples, demographic information, or identity data for a nonexistent program.",
    [
      {
        title: "No current cohort",
        body: "There are no represented dates, locations, compensation, eligibility requirements, immigration commitments, mentors, or selection stages.",
      },
      {
        title: "Future publication standard",
        body: "Any future program must publish verified terms, privacy information, accessible application steps, contacts, deadlines, and selection criteria before collecting data.",
      },
    ],
  ),
  page(
    "safety",
    "Safety at KovaGPT",
    "Safety",
    "How KovaGPT combines clear product boundaries, provider safeguards, application controls, reporting, and human judgment.",
    "No AI system is universally safe or accurate. KovaGPT surfaces limitations, restricts unauthorized actions, and keeps high-impact decisions with qualified people.",
    [
      {
        title: "Design for recovery",
        body: "Bound inputs and outputs, verify ownership, require confirmation for consequential actions, and return clear unavailable states when a dependency is not ready.",
      },
      {
        title: "Use appropriate review",
        body: "Medical, legal, financial, employment, education, security, and other high-impact uses need authoritative sources and qualified human review.",
      },
      {
        title: "Report concerns safely",
        body: "Use the relevant support or disclosure channel with reproducible, non-destructive evidence and only the minimum sensitive information required.",
      },
    ],
  ),
  page(
    "science",
    "Science with KovaGPT",
    "Research",
    "Use KovaGPT to organize scientific questions, compare supplied evidence, and draft reviewable analyses without overstating certainty.",
    "KovaGPT can assist with literature framing, methods discussion, code, tables, and explanations. It does not replace primary sources, reproducible methods, peer review, or domain expertise.",
    [
      {
        title: "Trace every claim",
        body: "Distinguish cited evidence from model synthesis, open the underlying paper or dataset, and verify quotations, methods, units, statistics, and dates.",
      },
      {
        title: "Preserve reproducibility",
        body: "Record inputs, assumptions, transformations, code, model and tool versions, exclusions, and uncertainty so another reviewer can inspect the work.",
      },
      {
        title: "Protect research participants",
        body: "Follow ethics, consent, institutional, privacy, biosafety, and data-governance requirements; do not expose confidential or controlled material unnecessarily.",
      },
    ],
  ),
  page(
    "security-and-privacy",
    "Security and privacy at KovaGPT",
    "Trust",
    "A combined view of KovaGPT application controls, data boundaries, and deployment-specific evidence.",
    "KovaGPT documents implemented authorization and privacy behavior without presenting unverified certifications, guarantees, vendor relationships, or contractual commitments.",
    [
      {
        title: "Application security",
        body: "Use authenticated ownership checks, tenant boundaries, server-held secrets, bounded inputs, auditable actions, and fail-closed provider authorization.",
      },
      {
        title: "Privacy controls",
        body: "Minimize collected data, distinguish account from device storage, expose implemented export and deletion controls, and document provider processing.",
      },
      {
        title: "Evidence has scope",
        body: "Deployment, identity, region, plan, vendor configuration, contracts, and current verification determine which assurance can truthfully be made.",
      },
    ],
  ),
  page(
    "solutions",
    "KovaGPT solutions",
    "Organizations",
    "Explore KovaGPT workflows for teams while keeping data, access, review, and availability boundaries explicit.",
    "Start from a real business problem, map the information and approvals it needs, then validate the configured product before describing the workflow as deployed.",
    [
      {
        title: "Knowledge work",
        body: "Draft, summarize, compare, plan, and analyze with source links, reusable project context, and accountable human review.",
      },
      {
        title: "Software and data",
        body: "Support code and analysis with repository boundaries, tests, reproducible calculations, provenance, and approval before consequential changes.",
      },
      {
        title: "Deployment fit",
        body: "Confirm users, plans, identity, connectors, providers, regions, retention, security requirements, support, and commercial terms for the actual organization.",
      },
    ],
  ),
  page(
    "student-collective",
    "KovaGPT student collective status",
    "Education program",
    "KovaGPT does not currently operate or accept applications for a student collective.",
    "Students can use the published learning guidance today, but this page does not imply a cohort, ambassador role, event, payment, credential, or institutional partnership.",
    [
      {
        title: "No application collection",
        body: "KovaGPT does not request school records, references, identity documents, demographic details, social accounts, or project submissions for this unavailable program.",
      },
      {
        title: "Learning remains available",
        body: "Use KovaGPT for explanations, guided practice, research planning, and organization while following course rules and protecting personal or institutional data.",
      },
    ],
  ),
  page(
    "transparency-and-content-moderation",
    "Transparency and content moderation",
    "Trust",
    "How KovaGPT describes safety boundaries, reports, enforcement, external dependencies, and the limits of automated review.",
    "Moderation can miss harmful material or restrict benign content. KovaGPT does not publish invented request volumes, enforcement rates, or government-reporting statistics.",
    [
      {
        title: "Layered decisions",
        body: "Provider safeguards, application policy, technical controls, user reports, and administrative review may each affect availability and enforcement.",
      },
      {
        title: "Meaningful disclosure",
        body: "Explain material restrictions and dependencies while withholding details that would expose private information, enable abuse, or compromise system security.",
      },
      {
        title: "Verified reporting only",
        body: "Any future transparency report must define its period, scope, categories, methodology, limitations, and source systems before presenting metrics.",
      },
    ],
  ),
  page(
    "trust-and-transparency",
    "Trust and transparency at KovaGPT",
    "Trust",
    "Navigate KovaGPT security, privacy, safety, moderation, data-control, and operational evidence.",
    "Trust comes from specific, current, inspectable behavior—not copied badges, broad guarantees, or claims that outlive their technical and contractual evidence.",
    [
      {
        title: "Implemented controls",
        body: "Review the product's authorization, data-control, safety, disclosure, status, and accessibility surfaces for behavior that exists today.",
      },
      {
        title: "Known boundaries",
        body: "Model errors, external providers, configuration, plan eligibility, network state, and human approval can all limit a workflow.",
      },
      {
        title: "No inferred assurance",
        body: "Certifications, audits, legal commitments, incident metrics, and partner relationships are stated only when verified for the relevant deployment and period.",
      },
    ],
  ),
];

export const EXPANDED_PUBLIC_PAGE_BY_SLUG = new Map(
  EXPANDED_PUBLIC_PAGES.map((item) => [item.slug, item]),
);
