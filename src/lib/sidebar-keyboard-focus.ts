/** Focus the reopened sidebar after its CSS visibility accepts focus. */
export function focusReopenedSidebar(trigger?: HTMLElement) {
  let frame = requestAnimationFrame(function focus() {
    const active = document.activeElement;
    // AppShell unmounts its external trigger, leaving body as the focus owner.
    if (active !== trigger && active !== document.body) return;
    const target = document.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]');
    target?.focus({ preventScroll: true });
    // React removes inert at commit; CSS visibility may require a later frame.
    if (document.activeElement !== target) frame = requestAnimationFrame(focus);
  });
  return () => cancelAnimationFrame(frame);
}
