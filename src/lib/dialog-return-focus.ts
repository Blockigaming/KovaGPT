/** Restore only a still-visible invoker on the same page; navigation owns its own focus. */
export function restoreDialogFocus(
  target: HTMLElement | null | undefined,
  openedUrl: string | undefined,
  skip = false,
) {
  if (
    skip ||
    typeof window === "undefined" ||
    openedUrl !== window.location.href ||
    !target?.isConnected ||
    !target.getClientRects().length ||
    target.closest('[inert], [aria-hidden="true"]') ||
    target.matches(":disabled")
  )
    return;
  target.focus({ preventScroll: true });
}

/** A route may replace a dialog's composer while closing it. Resolve its
 * destination after that commit, without taking focus from a later action. */
export function scheduleDialogFocusReturn(
  resolveTarget: () => HTMLElement | null | undefined,
  openedUrl: string | undefined,
  isCurrent: () => boolean,
) {
  if (typeof window === "undefined" || openedUrl !== window.location.href) return;
  const previousFocus = document.activeElement;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  document.addEventListener("pointerdown", interrupt, true);
  document.addEventListener("keydown", interrupt, true);
  window.addEventListener("blur", interrupt);
  window.requestAnimationFrame(() => {
    document.removeEventListener("pointerdown", interrupt, true);
    document.removeEventListener("keydown", interrupt, true);
    window.removeEventListener("blur", interrupt);
    if (interrupted || !isCurrent()) return;
    const target = resolveTarget();
    if (
      document.activeElement !== document.body &&
      document.activeElement !== previousFocus &&
      document.activeElement !== target
    )
      return;
    restoreDialogFocus(target, openedUrl);
  });
}
