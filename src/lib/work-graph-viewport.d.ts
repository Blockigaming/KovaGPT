declare module "@/lib/work-graph-viewport.mjs" {
  export const GRAPH_MIN_ZOOM: number;
  export const GRAPH_MAX_ZOOM: number;
  export function fitGraphViewport(
    rectangles: { x: number; y: number; width: number; height: number }[],
    viewport: { width: number; height: number },
    options?: { padding?: number; minZoom?: number; maxZoom?: number },
  ): { scale: number; offset: { x: number; y: number } } | null;
}
