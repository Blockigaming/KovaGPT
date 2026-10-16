/** Track the section at the same reading offset used by native fragment scrolling. */
export function trackLegalSection(root: HTMLElement, onActive: (id: string) => void) {
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-legal-section]"));
  if (!targets.length) return;
  let frame = 0;
  let active: string | undefined;
  const update = () => {
    frame = 0;
    let selected = targets[0];
    for (const target of targets) {
      const margin = Number.parseFloat(getComputedStyle(target).scrollMarginBlockStart) || 0;
      // One pixel accommodates fractional anchor positions after native scrolling.
      const readingOffset = Math.min(Math.max(0, margin), window.innerHeight - 1);
      if (target.getBoundingClientRect().top <= readingOffset + 1) selected = target;
    }
    const scroller = document.scrollingElement;
    const last = targets[targets.length - 1];
    // A short final section may never reach the reading line before scrolling ends.
    if (
      scroller &&
      scroller.scrollTop > 0 &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 &&
      last.getBoundingClientRect().top < window.innerHeight
    )
      selected = last;
    if (selected.id !== active) {
      active = selected.id;
      onActive(active);
    }
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("hashchange", schedule);
  window.addEventListener("popstate", schedule);
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  observer?.observe(root);
  schedule();
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("hashchange", schedule);
    window.removeEventListener("popstate", schedule);
    observer?.disconnect();
  };
}
