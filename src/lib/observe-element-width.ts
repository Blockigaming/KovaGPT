/** Notify on width changes outside ResizeObserver delivery, where layout writes are safe. */
export function observeElementWidth(element: HTMLElement, onWidth: (width: number) => void) {
  let width = element.clientWidth;
  let frame: number | null = null;
  const observer = new ResizeObserver(() => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const nextWidth = element.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      onWidth(width);
    });
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
