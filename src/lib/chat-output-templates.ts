export const chatOutputTypes = {
  docx: { label: "document", instruction: "Use Markdown headings and paragraphs." },
  pptx: {
    label: "presentation",
    instruction: "Use a level-two Markdown heading per slide and short bullet points.",
  },
  xlsx: {
    label: "spreadsheet",
    instruction: "Use a Markdown table per worksheet with a heading and column labels.",
  },
} as const;

export type ChatOutputFormat = keyof typeof chatOutputTypes;

const catalogs = {
  docx: [
    "Design Report|Experiment Analysis|Investment Committee Memo|Project Brief|Meeting Minutes|Executive Summary|Decision Record|Policy Proposal|Research Brief|Case Study",
    "Employee Handbook|Onboarding Guide|Performance Review|Job Description|Interview Guide|Training Manual|Mentoring Plan|Career Plan|Team Charter|Succession Plan",
    "Incident Report|Postmortem|Risk Assessment|Security Policy|Privacy Notice|Audit Plan|Compliance Checklist|Continuity Plan|Recovery Runbook|Access Review",
    "Product Requirements|Feature Specification|User Research Report|Usability Study|Release Notes|Technical Proposal|Architecture Decision|API Guide|Migration Plan|Quality Plan",
    "Business Plan|Grant Proposal|Budget Narrative|Fundraising Letter|Board Memo|Investor Update|Annual Report|Procurement Brief|Vendor Evaluation|Partnership Proposal",
    "Lesson Plan|Study Guide|Book Report|Essay Outline|Reading Journal|Lab Report|Historical Analysis|Research Poster Outline|Debate Brief|Field Trip Plan",
    "Press Release|Media Pitch|Newsletter|Editorial Brief|Brand Guide|Creative Brief|Campaign Plan|Website Copy Brief|Customer Story|Event Program",
    "Customer FAQ|Troubleshooting Guide|Support Playbook|Service Checklist|Account Review|Renewal Memo|Implementation Guide|Escalation Guide|Customer Interview|Feedback Summary",
    "Travel Itinerary|Moving Checklist|Home Maintenance Plan|Meal Plan|Volunteer Guide|Community Proposal|Event Plan|Workshop Agenda|Personal Goals|Weekly Review",
    "Literature Review|Survey Report|Interview Transcript Summary|Methods Protocol|Data Dictionary|Field Notes|Evaluation Framework|Findings Memo|Peer Review|Fact Sheet",
  ],
  pptx: [
    "Business Review|Market Trends Report|Operating Review|Investor Pitch|Quarterly Results|Company Overview|Strategy Update|Roadmap Review|Board Update|Annual Kickoff",
    "Product Demo|Feature Launch|Design Critique|User Research Readout|Prototype Walkthrough|Customer Journey|Competitive Analysis|Pricing Proposal|Growth Strategy|Product Vision",
    "Team Introduction|New Hire Orientation|Training Workshop|Leadership Briefing|Culture Overview|Recruiting Pitch|Learning Recap|Skills Workshop|Change Readiness|Team Retrospective",
    "Science Fair Presentation|Book Talk|History Timeline|Math Lesson|Language Lesson|Research Defense|Debate Opening|School Assembly|Study Review|Field Trip Debrief",
    "Campaign Proposal|Brand Reveal|Creative Pitch|Event Sponsorship|Social Strategy|Media Briefing|Content Planning|Audience Research|Marketing Results|Partner Showcase",
    "Sales Pitch|Customer Onboarding|Account Health Review|Renewal Proposal|Solution Comparison|Implementation Kickoff|Customer Case Study|Support Trends|Enablement Deck|Pilot Readout",
    "Budget Presentation|Funding Request|Forecast Review|Cost Reduction Plan|Unit Economics|Portfolio Overview|Procurement Recommendation|Financial Close|Spend Analysis|Capital Plan",
    "Architecture Overview|Migration Readiness|Incident Review|Security Awareness|Technical Deep Dive|System Demo|Quality Review|Data Platform Proposal|Reliability Update|Release Readiness",
    "Fundraiser Deck|Nonprofit Overview|Community Initiative|Volunteer Orientation|Program Evaluation|Public Meeting|Policy Briefing|Impact Report|Conference Talk|Panel Introduction",
    "Travel Photo Essay|Personal Portfolio|Exhibition Guide|Club Proposal|Sports Season Review|Event Recap|Competition Pitch|Wellness Workshop|Career Showcase|Year in Review",
  ],
  xlsx: [
    "Analytics Dashboard|Financial Budget|Operating Calendar|Sales Forecast|Expense Tracker|Revenue Model|Cash Flow Plan|Project Tracker|Inventory Register|Weekly Scorecard",
    "Subscription Tracker|Savings Planner|Debt Payoff Schedule|Household Budget|Travel Budget|Event Budget|Freelance Invoice Register|Purchase Log|Grant Budget|Cost Comparison",
    "Lead Pipeline|Opportunity Register|Sales Commission Tracker|Territory Planner|Quota Tracker|Renewal Calendar|Customer Cohorts|Churn Log|Account Segmentation|Customer Success Dashboard",
    "Content Calendar|Media Spend Tracker|Campaign Dashboard|Keyword Tracker|Channel Performance|Email Results|Social Metrics|Experiment Log|Conversion Funnel|Affiliate Tracker",
    "Team Roster|Shift Schedule|Time Sheet|Hiring Pipeline|Candidate Scorecard|Training Register|Leave Planner|Capacity Plan|Skills Matrix|Payroll Checklist",
    "Issue Tracker|Test Case Matrix|Bug Triage|Sprint Plan|Release Checklist|Dependency Map|Milestone Tracker|Risk Register|Stakeholder Register|Decision Log",
    "Stock Reorder Planner|Supplier Register|Shipment Tracker|Order Queue|Warehouse Counts|Equipment Register|Maintenance Schedule|Asset Depreciation|Returns Register|Service Log",
    "Gradebook|Assignment Planner|Attendance Register|Reading Tracker|Study Schedule|Lab Data Log|Survey Responses|Tutoring Schedule|Vocabulary List|Classroom Supplies",
    "Meal Planner|Recipe Costing|Workout Log|Habit Tracker|Home Inventory|Moving Planner|Packing List|Garden Planner|Donation Tracker|Volunteer Roster",
    "Data Quality Audit|Metric Dictionary|Research Coding Sheet|Scenario Comparison|Sensitivity Table|Benchmark Tracker|Operating Metrics|Variance Analysis|Resource Forecast|Annual Planning Matrix",
  ],
} satisfies Record<ChatOutputFormat, string[]>;

export const chatOutputTemplates = {
  docx: catalogs.docx.flatMap((group) => group.split("|")),
  pptx: catalogs.pptx.flatMap((group) => group.split("|")),
  xlsx: catalogs.xlsx.flatMap((group) => group.split("|")),
};

const starterStructures = {
  docx: [
    "Purpose, background, findings, recommendation, and next steps",
    "Role or audience, expectations, examples, and follow-up",
    "Scope, controls, evidence, findings, and corrective actions",
    "Problem, requirements, approach, validation, and rollout",
    "Opportunity, supporting evidence, resources, risks, and decision",
    "Learning objectives, materials, activities, and assessment",
    "Audience, core message, supporting details, and call to action",
    "Customer need, instructions, common issues, and escalation",
    "Goal, preparation, schedule, checklist, and follow-up",
    "Research question, methods, evidence, findings, and limitations",
  ],
  pptx: [
    "Opening, performance highlights, changes, priorities, and decisions",
    "Audience problem, findings, proposed solution, demo, and next steps",
    "Objectives, key concepts, examples, discussion, and takeaways",
    "Opening question, evidence, visual explanation, and summary",
    "Audience, opportunity, creative direction, channels, and measurement",
    "Customer challenge, approach, benefits, proof, and rollout",
    "Financial summary, drivers, assumptions, scenarios, and recommendation",
    "Background, system diagram outline, implementation, risks, and validation",
    "Community need, program, impact, and ways to participate",
    "Cover, narrative, highlights, visual suggestions, and closing",
  ],
  xlsx: [
    "Summary metrics, time periods, targets, actuals, and variance",
    "Categories, planned and actual amounts, dates, and totals",
    "Accounts, stages, owners, amounts, deadlines, and outcomes",
    "Channels, dates, inputs, results, and performance metrics",
    "People, roles, schedules, status, and capacity",
    "Work items, owners, priorities, dates, status, and blockers",
    "Items, quantities, locations, unit costs, and stock status",
    "Learners or activities, dates, scores, status, and progress",
    "Entries by date, categories, quantities, and notes",
    "Metrics, definitions, baseline, comparison, and findings",
  ],
} satisfies Record<ChatOutputFormat, string[]>;

const featuredStructures = {
  docx: [
    "Design objective, constraints, alternatives, rationale, and implementation",
    "Hypothesis, methods, control and treatment, results, limitations, and conclusion",
    "Decision requested, investment thesis, diligence, downside scenarios, and recommendation",
  ],
  pptx: [
    "Executive summary, quarter highlights, results versus targets, risks, and decisions",
    "Market snapshot, major trends, supporting evidence, implications, and outlook",
    "Weekly scorecard, operational issues, owners, and decisions needed",
  ],
  xlsx: [
    "KPI summary, traffic by channel, trends by period, and metric definitions",
    "Assumptions, monthly revenue and expenses, planned versus actual, and cash flow",
    "Annual calendar, monthly milestones, owners, deadlines, and status",
  ],
} satisfies Record<ChatOutputFormat, string[]>;

export type CustomChatOutputTemplate = {
  title: string;
  instructions: string;
  format: ChatOutputFormat;
};

export function parseCustomChatOutputTemplates(raw: string | null): {
  templates: CustomChatOutputTemplate[];
} {
  try {
    const parsed = raw ? JSON.parse(raw)?.templates : null;
    if (!Array.isArray(parsed)) return { templates: [] };
    return {
      templates: parsed
        .filter(
          (item): item is CustomChatOutputTemplate =>
            item &&
            typeof item.title === "string" &&
            item.title.trim() &&
            typeof item.instructions === "string" &&
            item.instructions.trim() &&
            Object.hasOwn(chatOutputTypes, item.format),
        )
        .slice(-30)
        .map(({ title, instructions, format }) => ({
          title: title.trim().slice(0, 80),
          instructions: instructions.trim().slice(0, 1000),
          format,
        })),
    };
  } catch {
    return { templates: [] };
  }
}

export function chatOutputPrompt(
  format: ChatOutputFormat,
  template?: string,
  customInstructions?: string,
) {
  const { label, instruction } = chatOutputTypes[format];
  const index = template ? chatOutputTemplates[format].indexOf(template) : -1;
  const outline =
    index < 0
      ? null
      : (featuredStructures[format][index] ?? starterStructures[format][Math.floor(index / 10)]);
  return [
    template
      ? `Create a ${label} using the ${template} starter template.`
      : `Create a custom ${label}.`,
    customInstructions
      ? `Template instructions: ${customInstructions}`
      : outline
        ? `Suggested structure: ${outline}.`
        : null,
    "If essential details are missing, ask me for them first. Mark any sample data clearly.",
    `Put the finished output in a fenced code block labeled kova-${format}. ${instruction}`,
  ]
    .filter(Boolean)
    .join(" ");
}
