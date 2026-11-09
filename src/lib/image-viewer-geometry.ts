export type ImageView = { scale: number; x: number; y: number };

/** Keep the rendered image covering its viewport on every pannable axis. */
export function clampImageView(
  view: ImageView,
  image: { width: number; height: number },
  viewport: { width: number; height: number },
): ImageView {
  const scale = Math.min(5, Math.max(1, Number.isFinite(view.scale) ? view.scale : 1));
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    scale,
    x: Math.max(-maxX, Math.min(maxX, Number.isFinite(view.x) ? view.x : 0)) || 0,
    y: Math.max(-maxY, Math.min(maxY, Number.isFinite(view.y) ? view.y : 0)) || 0,
  };
}
