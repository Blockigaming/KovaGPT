export type GraphNode = { id: string; status: string; durationMs: number | null };
export type GraphEdge = { id: string; source: string; target: string; type?: string };
export function topologicalOrder(nodes: GraphNode[], edges: GraphEdge[]): string[];
export function calculateCriticalPath(nodes: GraphNode[], edges: GraphEdge[]): any;
export function graphRelations(selected: string, edges: GraphEdge[]): any;
export function dagLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options?: { direction?: "LR" | "TB"; compact?: boolean },
): Record<string, { x: number; y: number }>;
