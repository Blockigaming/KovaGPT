// A reduced visual viewport can also mean pinch zoom, not an open keyboard.
export function composerKeyboardInset({
  layoutHeight,
  viewportHeight,
  viewportTop,
  scale,
  focused,
}) {
  if (!focused || !Number.isFinite(scale) || Math.abs(scale - 1) > 0.01) return 0;
  const gap = layoutHeight - viewportHeight - viewportTop;
  return Number.isFinite(gap) && gap > 40 ? Math.round(gap) : 0;
}
