export type RealtimeConnectionState =
  "unsupported" | "connecting" | "connected" | "reconnecting" | "offline" | "failed";
export type VoiceSessionState =
  | "idle"
  | "permission_required"
  | "ready"
  | "connecting"
  | "listening"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "ended"
  | "unavailable";
export type AgentRunState =
  | "queued"
  | "waiting"
  | "planning"
  | "running"
  | "approval_needed"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

export type RealtimeAdapter = {
  id: string;
  connect: (scope: string, signal: AbortSignal) => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  publish: (event: RealtimeEvent) => Promise<void>;
};

export type RealtimeEvent =
  | { type: "presence"; userId: string; displayName: string; color: string }
  | { type: "cursor"; userId: string; anchor: string; offset: number }
  | { type: "typing"; userId: string; active: boolean }
  | { type: "revision"; resourceId: string; revision: string }
  | { type: "activity"; actorId: string; action: string; occurredAt: string };

export type Conflict<T> = {
  base: T;
  local: T;
  remote: T;
  baseRevision: string;
  remoteRevision: string;
};
export type ConflictResolution<T> = { strategy: "local" | "remote" | "manual"; value: T };
export const resolveConflict = <T>(
  conflict: Conflict<T>,
  strategy: ConflictResolution<T>["strategy"],
  manual?: T,
): ConflictResolution<T> => ({
  strategy,
  value:
    strategy === "local"
      ? conflict.local
      : strategy === "remote"
        ? conflict.remote
        : (manual ?? conflict.local),
});

export type VoiceProviderAdapter = {
  id: string;
  connect: (options: { inputDeviceId?: string; signal: AbortSignal }) => Promise<void>;
  interrupt: () => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (listener: (event: VoiceEvent) => void) => () => void;
};
export type VoiceEvent =
  | { type: "transcript"; text: string; final: boolean; speaker: "user" | "assistant" }
  | { type: "latency"; milliseconds: number }
  | { type: "state"; state: VoiceSessionState }
  | { type: "error"; code: string; recoverable: boolean };

const transitions: Record<AgentRunState, readonly AgentRunState[]> = {
  queued: ["waiting", "planning", "cancelled"],
  waiting: ["planning", "running", "cancelled"],
  planning: ["running", "approval_needed", "paused", "failed", "cancelled"],
  running: ["approval_needed", "paused", "failed", "completed", "cancelled"],
  approval_needed: ["running", "paused", "cancelled"],
  paused: ["queued", "running", "cancelled"],
  failed: ["queued", "cancelled"],
  completed: [],
  cancelled: [],
};
export function canTransitionAgent(from: AgentRunState, to: AgentRunState) {
  return transitions[from].includes(to);
}

export type PipelineNode = {
  id: string;
  type: "input" | "agent" | "condition" | "tool" | "memory" | "context" | "schedule" | "output";
  label: string;
  requiresBackend?: boolean;
};
export type PipelineEdge = { from: string; to: string; condition?: string };
export type PipelineDefinition = {
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};
export type SimulationResult = {
  valid: boolean;
  order: string[];
  errors: string[];
  backendRequired: string[];
};

export function simulatePipeline(pipeline: PipelineDefinition): SimulationResult {
  const errors: string[] = [];
  const ids = new Set(pipeline.nodes.map((node) => node.id));
  if (ids.size !== pipeline.nodes.length) errors.push("Node IDs must be unique");
  for (const edge of pipeline.edges)
    if (!ids.has(edge.from) || !ids.has(edge.to))
      errors.push(`Invalid edge ${edge.from} → ${edge.to}`);
  const incoming = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  for (const edge of pipeline.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of pipeline.edges.filter((item) => item.from === id)) {
      const count = (incoming.get(edge.to) ?? 0) - 1;
      incoming.set(edge.to, count);
      if (count === 0) queue.push(edge.to);
    }
  }
  if (order.length !== pipeline.nodes.length) errors.push("Workflow contains a cycle");
  if (!pipeline.nodes.some((node) => node.type === "input")) errors.push("Workflow needs an input");
  if (!pipeline.nodes.some((node) => node.type === "output"))
    errors.push("Workflow needs an output");
  return {
    valid: errors.length === 0,
    order,
    errors,
    backendRequired: pipeline.nodes.filter((node) => node.requiresBackend).map((node) => node.id),
  };
}
