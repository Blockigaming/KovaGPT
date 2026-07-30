export type Plan = "free" | "plus" | "pro" | "business";
export type CapabilityPermission = "public" | "authenticated" | "workspace_admin";

export type CapabilityDefinition = Readonly<{
  id: string;
  label: string;
  route: string;
  permission: CapabilityPermission;
  requiredPlan: Plan;
  providers: readonly string[];
  flags: readonly string[];
  dependencies: readonly string[];
  keywords: readonly string[];
}>;

const define = (definition: CapabilityDefinition) => Object.freeze(definition);

export const CAPABILITIES = Object.freeze([
  define({
    id: "chat",
    label: "Chat",
    route: "/",
    permission: "public",
    requiredPlan: "free",
    providers: ["ai"],
    flags: [],
    dependencies: [],
    keywords: ["conversation", "assistant"],
  }),
  define({
    id: "projects",
    label: "Projects",
    route: "/projects",
    permission: "authenticated",
    requiredPlan: "free",
    providers: [],
    flags: [],
    dependencies: ["chat"],
    keywords: ["workspace", "organize"],
  }),
  define({
    id: "work",
    label: "Work mode",
    route: "/work",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: ["ai"],
    flags: ["work_mode"],
    dependencies: ["projects", "library"],
    keywords: ["agent", "tasks", "plans"],
  }),
  define({
    id: "research",
    label: "Research planner",
    route: "/research-planner",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: ["search"],
    flags: ["research_planner"],
    dependencies: ["library"],
    keywords: ["deep research", "sources"],
  }),
  define({
    id: "library",
    label: "Library",
    route: "/library",
    permission: "authenticated",
    requiredPlan: "free",
    providers: [],
    flags: [],
    dependencies: [],
    keywords: ["documents", "artifacts", "saved"],
  }),
  define({
    id: "files",
    label: "Files",
    route: "/files",
    permission: "authenticated",
    requiredPlan: "free",
    providers: [],
    flags: [],
    dependencies: ["library"],
    keywords: ["uploads", "storage"],
  }),
  define({
    id: "images",
    label: "Images",
    route: "/images",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: ["image"],
    flags: [],
    dependencies: ["library"],
    keywords: ["gallery", "generate"],
  }),
  define({
    id: "apps",
    label: "Apps",
    route: "/apps",
    permission: "authenticated",
    requiredPlan: "free",
    providers: ["google"],
    flags: [],
    dependencies: [],
    keywords: ["connectors", "gmail", "drive", "calendar"],
  }),
  define({
    id: "memory",
    label: "Memory",
    route: "/memory",
    permission: "authenticated",
    requiredPlan: "free",
    providers: [],
    flags: [],
    dependencies: ["chat"],
    keywords: ["personalization", "context"],
  }),
  define({
    id: "context-packs",
    label: "Context Packs",
    route: "/context-packs",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: [],
    flags: ["context_packs"],
    dependencies: ["library", "memory"],
    keywords: ["collections", "context"],
  }),
  define({
    id: "prompt-studio",
    label: "Prompt Studio",
    route: "/prompt-studio",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: ["ai"],
    flags: ["prompt_studio"],
    dependencies: ["projects"],
    keywords: ["templates", "variables", "evaluation"],
  }),
  define({
    id: "knowledge-graph",
    label: "Knowledge Graph",
    route: "/knowledge-graph",
    permission: "authenticated",
    requiredPlan: "pro",
    providers: [],
    flags: ["knowledge_graph"],
    dependencies: ["projects", "library", "memory"],
    keywords: ["relationships", "timeline"],
  }),
  define({
    id: "automations",
    label: "Scheduled Tasks",
    route: "/scheduled-tasks",
    permission: "authenticated",
    requiredPlan: "plus",
    providers: ["scheduler"],
    flags: ["automations"],
    dependencies: ["work"],
    keywords: ["automation", "schedule"],
  }),
  define({
    id: "omega",
    label: "Omega Control Center",
    route: "/omega",
    permission: "authenticated",
    requiredPlan: "pro",
    providers: [],
    flags: ["omega_control_center"],
    dependencies: ["work", "apps", "projects"],
    keywords: ["agents", "enterprise", "voice", "realtime", "mcp", "pipelines"],
  }),
] satisfies readonly CapabilityDefinition[]);

const byId = new Map(CAPABILITIES.map((capability) => [capability.id, capability]));
export const getCapability = (id: string) => byId.get(id);

export function validateCapabilityRegistry(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const capability of CAPABILITIES) {
    if (ids.has(capability.id)) errors.push(`Duplicate capability: ${capability.id}`);
    ids.add(capability.id);
  }
  for (const capability of CAPABILITIES)
    for (const dependency of capability.dependencies)
      if (!byId.has(dependency))
        errors.push(`${capability.id} has unknown dependency ${dependency}`);
  return errors;
}
