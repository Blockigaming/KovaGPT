import type { Plan } from "./capabilities";

export type FlagDefinition = Readonly<{
  id: string;
  defaultEnabled: boolean;
  plans?: readonly Plan[];
  rollout?: number;
  beta?: boolean;
  experimental?: boolean;
  killSwitch?: boolean;
}>;

export type FlagContext = {
  userId?: string | null;
  plan?: Plan;
  userFlags?: Record<string, boolean>;
};

export const FEATURE_FLAGS: readonly FlagDefinition[] = Object.freeze([
  { id: "work_mode", defaultEnabled: true, plans: ["plus", "pro", "business"] },
  { id: "research_planner", defaultEnabled: true, plans: ["plus", "pro", "business"] },
  { id: "context_packs", defaultEnabled: true, plans: ["plus", "pro", "business"] },
  { id: "prompt_studio", defaultEnabled: true, plans: ["plus", "pro", "business"] },
  { id: "knowledge_graph", defaultEnabled: true, plans: ["pro", "business"] },
  { id: "automations", defaultEnabled: true, plans: ["plus", "pro", "business"] },
  { id: "omega_control_center", defaultEnabled: true, plans: ["pro", "business"], beta: true },
  { id: "developer_console", defaultEnabled: import.meta.env.DEV, experimental: true },
]);

const definitions = new Map(FEATURE_FLAGS.map((flag) => [flag.id, flag]));
const hashBucket = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0) % 100;
};

export function isFeatureEnabled(id: string, context: FlagContext = {}): boolean {
  const flag = definitions.get(id);
  if (!flag || flag.killSwitch) return false;
  const override = context.userFlags?.[id];
  if (override !== undefined) return override;
  if (flag.plans && !flag.plans.includes(context.plan ?? "free")) return false;
  if (flag.rollout !== undefined) {
    if (!context.userId) return false;
    return hashBucket(`${id}:${context.userId}`) < Math.max(0, Math.min(100, flag.rollout));
  }
  return flag.defaultEnabled;
}
