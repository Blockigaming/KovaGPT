/**
 * Touch drawer: swipe right from the left edge to open, swipe left to close.
 */
export function isClearSidebarSwipe({ open, dx, dy, elapsedMs }) {
  if (![dx, dy, elapsedMs].every(Number.isFinite)) return false;
  if (elapsedMs < 0 || elapsedMs > 750) return false;
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  return (
    horizontal >= 88 && vertical <= 48 && horizontal >= vertical * 2 && (open ? dx < 0 : dx > 0)
  );
}
