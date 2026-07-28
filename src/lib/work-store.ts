export type WorkStatus = "planning" | "paused" | "completed" | "cancelled";
export type WorkStep = {
  id: string;
  text: string;
  done: boolean;
  approval: boolean;
  approved: boolean;
};
export type WorkTask = {
  id: string;
  objective: string;
  project?: string;
  context: string;
  steps: WorkStep[];
  deliverables: string[];
  status: WorkStatus;
  createdAt: number;
  updatedAt: number;
};
const KEY = "kova-work-tasks-v1";
const TEMPLATE_KEY = "kova-work-templates-v1";
const AGENT_KEY = "kova-agent-workspace-v1";
export type WorkTemplate = {
  id: string;
  name: string;
  objective: string;
  context: string;
  plan: string[];
  updatedAt: number;
};
export type AgentRunStatus =
  | "draft"
  | "ready"
  | "handed_off"
  | "approval_needed"
  | "paused"
  | "failed"
  | "completed";
export type AgentRun = {
  id: string;
  name: string;
  objective: string;
  instructions: string;
  project: string;
  context: string[];
  tools: ("web" | "files" | "apps")[];
  steps: string[];
  approvalSteps: number[];
  status: AgentRunStatus;
  log: { at: number; message: string }[];
  createdAt: number;
  updatedAt: number;
};
export function loadWorkTasks(): WorkTask[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as WorkTask[];
  } catch {
    return [];
  }
}
export function saveWorkTasks(tasks: WorkTask[]) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(tasks));
}
export function createWorkTask(
  objective: string,
  project: string,
  context: string,
  plan: string[],
): WorkTask {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    objective,
    project: project || undefined,
    context,
    steps: plan.filter(Boolean).map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
      approval: false,
      approved: false,
    })),
    deliverables: [],
    status: "planning",
    createdAt: now,
    updatedAt: now,
  };
}
export function loadWorkTemplates(): WorkTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "[]") as WorkTemplate[];
  } catch {
    return [];
  }
}
export function saveWorkTemplates(templates: WorkTemplate[]) {
  if (typeof window !== "undefined") localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
}
export function loadAgentRuns(): AgentRun[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(AGENT_KEY) ?? "[]") as AgentRun[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
export function saveAgentRuns(runs: AgentRun[]) {
  if (typeof window !== "undefined") localStorage.setItem(AGENT_KEY, JSON.stringify(runs));
}
