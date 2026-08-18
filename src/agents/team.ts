export type AgentRole =
  "planner" | "research" | "browser" | "file" | "coding" | "writing" | "review";
export type AgentTaskInput = {
  key: string;
  role: AgentRole;
  title: string;
  instructions: string;
  dependencies: string[];
  checkpoint?: boolean;
  reusableSubplan?: string;
};
export type AgentWorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  tasks: AgentTaskInput[];
};
const task = (
  key: string,
  role: AgentRole,
  title: string,
  dependencies: string[] = [],
  checkpoint = false,
): AgentTaskInput => ({
  key,
  role,
  title,
  dependencies,
  checkpoint,
  instructions: title,
});
export const AGENT_WORKFLOW_TEMPLATES: AgentWorkflowTemplate[] = [
  {
    id: "research-report",
    name: "Research Report",
    description: "Collect evidence, compare sources, write and verify a cited report.",
    tasks: [
      task("plan", "planner", "Create the research plan"),
      task("research", "research", "Collect and compare credible sources", ["plan"]),
      task("write", "writing", "Draft a structured report with citations", ["research"]),
      task("review", "review", "Verify claims, citations, and conclusions", ["write"], true),
    ],
  },
  {
    id: "website-audit",
    name: "Website Audit",
    description: "Inspect a website and deliver prioritized findings.",
    tasks: [
      task("plan", "planner", "Define audit criteria"),
      task("browse", "browser", "Inspect the website and capture evidence", ["plan"]),
      task("review", "review", "Prioritize usability, content, and technical findings", ["browse"]),
      task("write", "writing", "Prepare the audit report", ["review"]),
    ],
  },
  {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Research competitors in parallel and synthesize differences.",
    tasks: [
      task("plan", "planner", "Define competitors and comparison criteria"),
      task("market", "research", "Research market positioning", ["plan"]),
      task("products", "browser", "Compare public product experiences", ["plan"]),
      task("synthesis", "writing", "Build the comparison and recommendations", [
        "market",
        "products",
      ]),
      task("review", "review", "Challenge assumptions and verify evidence", ["synthesis"], true),
    ],
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Inspect code context, identify risks, propose a patch, and review it.",
    tasks: [
      task("inspect", "coding", "Inspect repository context and architecture"),
      task("patch", "coding", "Propose focused code changes", ["inspect"]),
      task("review", "review", "Review the proposed patch for regressions", ["patch"], true),
    ],
  },
  {
    id: "marketing-plan",
    name: "Marketing Plan",
    description: "Research the audience, create a plan, and polish deliverables.",
    tasks: [
      task("plan", "planner", "Define goals, audience, constraints, and channels"),
      task("research", "research", "Collect market and audience evidence", ["plan"]),
      task("draft", "writing", "Draft the campaign plan and assets", ["research"]),
      task("review", "review", "Review positioning and measurable outcomes", ["draft"], true),
    ],
  },
  {
    id: "financial-summary",
    name: "Financial Summary",
    description: "Analyze authorized files and produce a read-only summary.",
    tasks: [
      task("files", "file", "Inspect the authorized financial files"),
      task("analysis", "research", "Compare periods and identify supported patterns", ["files"]),
      task("write", "writing", "Prepare a factual financial summary", ["analysis"]),
      task("review", "review", "Verify calculations and disclosures", ["write"], true),
    ],
  },
  {
    id: "meeting-prep",
    name: "Meeting Preparation",
    description: "Collect context and create a concise briefing.",
    tasks: [
      task("context", "file", "Collect relevant Project, File, Memory, and App context"),
      task("research", "research", "Resolve open questions", ["context"]),
      task("brief", "writing", "Prepare agenda, briefing, and questions", ["context", "research"]),
    ],
  },
  {
    id: "bug-investigation",
    name: "Bug Investigation",
    description: "Inspect evidence, form hypotheses, and review a fix plan.",
    tasks: [
      task("inspect", "coding", "Inspect logs, code context, and reproduction details"),
      task("research", "research", "Research relevant APIs and known failure modes", ["inspect"]),
      task("plan", "coding", "Propose a minimal fix and verification plan", [
        "inspect",
        "research",
      ]),
      task("review", "review", "Review the fix plan for regressions", ["plan"], true),
    ],
  },
  {
    id: "shopping-research",
    name: "Shopping Research",
    description: "Compare products from real sources without purchasing.",
    tasks: [
      task("criteria", "planner", "Define requirements and budget"),
      task("browse", "browser", "Collect product facts and current source timestamps", [
        "criteria",
      ]),
      task("compare", "research", "Compare tradeoffs and evidence", ["browse"]),
      task("review", "review", "Verify the shortlist and disclose uncertainty", ["compare"]),
    ],
  },
  {
    id: "travel-planner",
    name: "Travel Planner",
    description: "Research a trip and prepare an itinerary without booking.",
    tasks: [
      task("plan", "planner", "Define dates, constraints, interests, and budget"),
      task("browse", "browser", "Research destinations and logistics", ["plan"]),
      task("itinerary", "writing", "Build a structured itinerary", ["browse"]),
      task("review", "review", "Verify timings, sources, and booking caveats", ["itinerary"], true),
    ],
  },
];

export function validateTaskGraph(tasks: AgentTaskInput[]) {
  const errors: string[] = [];
  const keys = new Set(tasks.map((item) => item.key));
  if (!tasks.length) errors.push("At least one specialist is required");
  if (keys.size !== tasks.length) errors.push("Task keys must be unique");
  for (const item of tasks)
    for (const dependency of item.dependencies)
      if (!keys.has(dependency)) errors.push(`${item.key} depends on missing task ${dependency}`);
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const byKey = new Map(tasks.map((item) => [item.key, item]));
  const visit = (key: string) => {
    if (visiting.has(key)) {
      errors.push("Task graph contains a cycle");
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dep of byKey.get(key)?.dependencies ?? []) visit(dep);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
  return [...new Set(errors)];
}
