declare module "@/lib/work-graph.mjs" {
  export type GraphNode = { id: string; status: string; durationMs: number | null };
  export type GraphEdge = { id: string; source: string; target: string; type?: string };
  export function topologicalOrder(nodes: GraphNode[], edges: GraphEdge[]): string[];
  export type CriticalPathTask = {
    id: string;
    earliestStart: number;
    earliestFinish: number;
    latestStart: number;
    latestFinish: number;
    slack: number;
    critical: boolean;
  };
  export type CriticalPathResult = {
    order: string[];
    tasks: CriticalPathTask[];
    criticalNodes: string[];
    criticalEdges: string[];
    totalKnownDurationMs: number;
    unknownDurationNodes: string[];
    incomplete: boolean;
    blockedCriticalPath: string[];
  };
  export type GraphRelationResult = {
    directPrerequisites: Set<string>;
    prerequisites: Set<string>;
    directDependents: Set<string>;
    dependents: Set<string>;
  };
  export function calculateCriticalPath(nodes: GraphNode[], edges: GraphEdge[]): CriticalPathResult;
  export function graphRelations(selected: string, edges: GraphEdge[]): GraphRelationResult;
  export function dagLayout(
    nodes: GraphNode[],
    edges: GraphEdge[],
    options?: { direction?: "LR" | "TB"; compact?: boolean },
  ): Record<string, { x: number; y: number }>;
}
