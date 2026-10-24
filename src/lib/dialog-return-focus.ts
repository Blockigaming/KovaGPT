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
