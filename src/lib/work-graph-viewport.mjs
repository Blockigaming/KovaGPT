/** Pure presentation geometry. Does not change persisted graph records. */
export const GRAPH_MIN_ZOOM = 0.1;
export const GRAPH_MAX_ZOOM = 1.8;

export function fitGraphViewport(rectangles, viewport, options = {}) {
  const padding = options.padding ?? 8;
  const minZoom = options.minZoom ?? GRAPH_MIN_ZOOM;
  const maxZoom = options.maxZoom ?? 1;
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= padding * 2 ||
    viewport.height <= padding * 2 ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    !Number.isFinite(minZoom) ||
    minZoom <= 0 ||
    !Number.isFinite(maxZoom) ||
    maxZoom < minZoom
  )
    return null;
  if (!rectangles.length) return { scale: 1, offset: { x: 0, y: 0 } };
  if (
    rectangles.some(
      (r) => ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0,
    )
  )
    return null;
  const left = Math.min(...rectangles.map((r) => r.x));
  const top = Math.min(...rectangles.map((r) => r.y));
  const right = Math.max(...rectangles.map((r) => r.x + r.width));
  const bottom = Math.max(...rectangles.map((r) => r.y + r.height));
  const scale = Math.max(
    minZoom,
    Math.min(
      maxZoom,
      (viewport.width - padding * 2) / (right - left),
      (viewport.height - padding * 2) / (bottom - top),
    ),
  );
  return {
    scale,
    offset: {
      x: (viewport.width - (right - left) * scale) / 2 - left * scale,
      y: (viewport.height - (bottom - top) * scale) / 2 - top * scale,
    },
  };
}
