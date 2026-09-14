import type { PublicDetailPage } from "@/lib/public-detail-content";
import { PUBLIC_GLOBAL_AFFAIRS_PATHS } from "@/lib/seo-policy.mjs";

const TITLES: Readonly<Record<string, string>> = Object.freeze({
  "1000-scientist-ai-jam-session": "AI research workshop status",
  "a-primer-on-the-eu-ai-act": "EU AI Act implementation primer",
  "accelerating-ai-uptake-in-europe": "Responsible AI adoption in Europe",
  aft: "Education partnership reference status",
  "ai-stories-daily-benefits-bigger-opportunities": "Everyday AI benefits and opportunities",
  "an-update-on-disrupting-deceptive-uses-of-ai": "Disrupting deceptive AI use: safety approach",
  "argentinas-ai-opportunity": "Argentina's AI opportunity",
  "brazil-ai-moment-is-here": "Brazil's AI opportunity",
  "college-students-and-chatgpt": "Supporting college students with AI",
  "comment-on-ntia-ai-accountability-policy": "US AI accountability policy reference",
  "comments-to-the-ntia-on-data-center-growth-resilience-and-security":
    "Data-center growth, resilience, and security",
  "disrupting-malicious-uses-of-ai-june-2025": "Malicious AI-use disruption status: June 2025",
  "disrupting-malicious-uses-of-ai-october-2025":
    "Malicious AI-use disruption status: October 2025",
  "disrupting-malicious-uses-of-ai": "Disrupting malicious uses of AI",
  "eu-code-of-practice": "EU AI Code of Practice overview",
  "intellectual-freedom-by-design": "Intellectual freedom in AI product design",
  "introducing-chatgpt-gov": "Public-sector AI workspace guidance",
  "introducing-openai-for-government": "KovaGPT public-sector service status",
  "introducing-the-intelligence-age": "Preparing institutions for advanced AI",
  "learning-accelerator": "AI learning accelerator status",
  "letter-to-governor-newsom-on-harmonized-regulation": "State AI regulation policy reference",
  "new-economic-analysis": "AI economic analysis methods",
  "open-weights-and-ai-for-all": "Open-weight AI access and safeguards",
  "openai-academy": "KovaGPT learning resources",
  "openai-and-uk-government-partnership": "UK government partnership reference status",
  "openai-at-the-paris-ai-action-summit": "Paris AI Action Summit reference status",
  "openai-chief-compliance-officer-announcement": "Compliance leadership announcement status",
  "openai-chief-economist-announcement": "Economist leadership announcement status",
  "openai-for-australia": "KovaGPT availability in Australia",
  "openai-for-countries": "Regional KovaGPT program status",
  "openai-for-germany": "KovaGPT availability in Germany",
  "openai-for-greece": "KovaGPT availability in Greece",
  "openai-nonprofit-jam": "Nonprofit AI workshop status",
  "openai-proposals-for-the-us-ai-action-plan": "US AI Action Plan policy proposals",
  "openai-s-comment-to-the-ntia-on-open-model-weights": "Open model-weights policy reference",
  "openais-approach-to-ai-and-national-security": "AI and national-security governance",
  "openais-australia-economic-blueprint": "Australia AI economic-readiness guide",
  "openais-economic-blueprint": "AI economic-readiness guide",
  "openais-eu-economic-blueprint": "European AI economic-readiness guide",
  "our-approach-to-frontier-risk": "Frontier AI risk-management approach",
  "response-to-department-of-energy": "Energy and AI policy-response status",
  "response-to-nist-executive-order-on-ai": "AI standards policy-response status",
  "response-to-uk-copyright-consultation": "UK copyright consultation reference",
  "sam-altman-senate-questions-for-the-record": "US Senate policy record reference",
  "scaling-the-openai-academy": "Scaling responsible AI learning programs",
  "seizing-the-ai-opportunity": "Planning for broad AI opportunity",
  "strategic-collaboration-with-japan-digital-agency":
    "Japan government collaboration reference status",
  "testimony-of-sam-altman-before-the-us-senate": "US Senate testimony reference status",
  "the-power-of-personalized-ai": "Personalized AI benefits and safeguards",
  "the-washington-post-partners-with-openai": "Media partnership reference status",
});

type Topic = "education" | "policy" | "readiness" | "safety" | "status";

const statusPattern =
  /(?:aft$|announcement|jam-session|learning-accelerator|nonprofit-jam|partnership|partners-with|summit|testimony|questions-for-the-record|strategic-collaboration)/u;
const safetyPattern = /(?:deceptive|malicious|national-security|frontier-risk|open-weights)/u;
const educationPattern = /(?:academy|college-students|learning)/u;
const policyPattern =
  /(?:ai-act|accountability-policy|code-of-practice|comment|consultation|governor|nist|department-of-energy|action-plan|regulation)/u;

const topicFor = (path: string): Topic => {
  if (statusPattern.test(path)) return "status";
  if (safetyPattern.test(path)) return "safety";
  if (educationPattern.test(path)) return "education";
  if (policyPattern.test(path)) return "policy";
  return "readiness";
};

const primaryActionFor = (topic: Topic): PublicDetailPage["primaryAction"] => {
  if (topic === "education") return { label: "Explore KovaGPT learning guides", to: "/academy" };
  if (topic === "safety") return { label: "Review KovaGPT safety", to: "/safety" };
  if (topic === "policy")
    return { label: "Review trust and transparency", to: "/trust-and-transparency" };
  if (topic === "status") return { label: "Verify KovaGPT information", to: "/about" };
  return { label: "Explore public-sector workflows", to: "/solutions/industries/government" };
};

const contentFor = (topic: Topic, title: string): PublicDetailPage["sections"] => {
  if (topic === "status") {
    return [
      {
        title: "Current KovaGPT status",
        body: `This exact-path reference does not import or republish the external announcement associated with “${title}.” KovaGPT does not claim the named event, appointment, testimony, collaboration, partnership, program, or third-party endorsement as its own.`,
        points: [
          "No external relationship or participation is implied",
          "No registration, appointment, or program access is offered here",
          "Only current KovaGPT pages describe supported services and commitments",
        ],
      },
      {
        title: "Verify before relying on a public claim",
        body: "Check the named organization's current primary source for its historical record. For KovaGPT, use the linked company, product, policy, and contact pages and request written confirmation before relying on a relationship, availability promise, public-sector commitment, or contractual statement.",
        points: [
          "Separate external history from current KovaGPT facts",
          "Confirm dates, scope, participants, and authority",
          "Treat unsupported or outdated claims as unavailable",
        ],
      },
    ];
  }
  if (topic === "safety") {
    return [
      {
        title: "Threat-model the actual workflow",
        body: `Use ${title.toLowerCase()} as a prompt to identify realistic actors, assets, abuse paths, affected people, uncertainty, and escalation thresholds. Controls should match the capability, access, scale, and consequences of the deployed system rather than a generic risk label.`,
        points: [
          "Test benign, ambiguous, and adversarial requests",
          "Limit tools, data, permissions, and unattended actions",
          "Record evidence for review without exposing sensitive content",
        ],
      },
      {
        title: "Operate with layered safeguards",
        body: "Combine product policy, authentication, authorization, rate limits, monitoring, incident response, human review, and recovery. Recheck safeguards whenever models, tools, data sources, users, or operating conditions change.",
        points: [
          "Define who can stop or reverse an action",
          "Escalate credible abuse and high-impact uncertainty",
          "Measure false positives, missed harms, and control drift",
        ],
      },
    ];
  }
  if (topic === "education") {
    return [
      {
        title: "Start with the learning objective",
        body: `For ${title.toLowerCase()}, define what learners should understand or produce, what help is permitted, and how independent understanding will be checked. AI output should support instruction and practice rather than substitute for learning or accountable assessment.`,
        points: [
          "Make permitted AI assistance explicit",
          "Use age-appropriate privacy and safety boundaries",
          "Verify sources, calculations, and generated examples",
        ],
      },
      {
        title: "Evaluate access and outcomes",
        body: "Pilot with representative learners and educators, provide a non-AI path where needed, and measure accessibility, learning quality, workload, error patterns, and uneven impact. Keep educators responsible for consequential decisions.",
        points: [
          "Avoid entering unnecessary student information",
          "Provide review and correction paths",
          "Retire activities that do not improve learning",
        ],
      },
    ];
  }
  if (topic === "policy") {
    return [
      {
        title: "Read the governing primary sources",
        body: `${title} can involve changing law, regulation, standards, or consultation records. This KovaGPT guide is not the external submission, legal text, or official interpretation. Identify the jurisdiction, effective date, regulated role, system use, and authoritative source before deciding what applies.`,
        points: [
          "Distinguish enacted rules from proposals and voluntary guidance",
          "Confirm definitions, exemptions, duties, and deadlines",
          "Use qualified legal or compliance review when consequences are material",
        ],
      },
      {
        title: "Turn requirements into evidence",
        body: "Map each applicable obligation to an owner, control, test, retained record, incident path, and review schedule. Include privacy, security, transparency, accessibility, human oversight, vendor, and change-management evidence as the real context requires.",
        points: [
          "Document assumptions and unresolved questions",
          "Test controls against the deployed workflow",
          "Revalidate after product, provider, or policy changes",
        ],
      },
    ];
  }
  return [
    {
      title: "Assess local readiness",
      body: `Evaluate ${title.toLowerCase()} through the real users, infrastructure, languages, accessibility needs, institutions, skills, energy and connectivity constraints, data governance, procurement rules, and economic goals in scope. Avoid assuming one deployment pattern fits every region or sector.`,
      points: [
        "Define a specific public benefit and accountable owner",
        "Include affected communities and domain experts",
        "Measure distribution of benefits, costs, and errors",
      ],
    },
    {
      title: "Pilot before scaling",
      body: "Begin with a bounded, reversible workflow and approved information. Verify provider availability, identity, permissions, retention, security, accessibility, cost, monitoring, human review, and recovery before expanding access or making consequential decisions.",
      points: [
        "Publish success, safety, and stop criteria",
        "Keep important decisions reviewable and appealable",
        "Expand only when evidence supports the next stage",
      ],
    },
  ];
};

const globalAffairsPage = (path: string): PublicDetailPage => {
  const slug = path.slice("/global-affairs/".length);
  const title = TITLES[slug];
  if (!title) throw new Error(`Missing global-affairs title for ${path}`);
  const topic = topicFor(path);
  const status = topic === "status";
  return {
    section: "global-affairs",
    slug,
    eyebrow: status ? "Public reference status" : "KovaGPT public-interest guide",
    title,
    description: status
      ? `${title} at KovaGPT, with clear boundaries around external announcements, relationships, programs, and dated claims.`
      : `Original KovaGPT guidance for ${title.toLowerCase()}, with primary-source checks, accountable review, and practical safeguards.`,
    summary: status
      ? "This compatibility page records a safe KovaGPT boundary for an external public-affairs reference. It does not reproduce the source announcement or claim the relationship, event, appointment, testimony, program, or endorsement."
      : `Use this original KovaGPT guide to evaluate ${title.toLowerCase()} with current primary sources, local context, measurable outcomes, and people accountable for consequential decisions.`,
    highlights: status
      ? ["No imported announcement", "No implied relationship", "Current KovaGPT links"]
      : ["Primary sources", "Local context", "Accountable safeguards"],
    primaryAction: primaryActionFor(topic),
    secondaryAction: { label: "Trust and transparency", to: "/trust-and-transparency" },
    sections: contentFor(topic, title),
  };
};

export const PUBLIC_GLOBAL_AFFAIRS_PAGES: readonly PublicDetailPage[] =
  PUBLIC_GLOBAL_AFFAIRS_PATHS.map(globalAffairsPage);

export const PUBLIC_GLOBAL_AFFAIRS_PAGE_BY_KEY = new Map(
  PUBLIC_GLOBAL_AFFAIRS_PAGES.map((page) => [`${page.section}/${page.slug}`, page]),
);
