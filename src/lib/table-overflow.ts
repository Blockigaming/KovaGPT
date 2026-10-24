export type TableOverflow = { overflow: boolean; atStart: boolean; atEnd: boolean };

/** Measure actual rendered columns; never change the reader's scroll position. */
export function measureTableOverflow(
  element: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollLeft">,
): TableOverflow {
  const remaining = Math.max(0, element.scrollWidth - element.clientWidth);
  const position = Math.abs(element.scrollLeft);
  return { overflow: remaining > 1, atStart: position <= 1, atEnd: position >= remaining - 1 };
}

export function observeTableOverflow(
  container: HTMLElement,
  table: HTMLElement,
  update: (value: TableOverflow) => void,
) {
  let active = true;
  let previous = "";
  const measure = () => {
    if (!active) return;
    const value = measureTableOverflow(container);
    const signature = JSON.stringify(value);
    if (signature !== previous) {
      previous = signature;
      update(value);
    }
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  resize?.observe(container);
  resize?.observe(table);
  const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
  mutation?.observe(table, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const view = container.ownerDocument.defaultView;
  container.addEventListener("scroll", measure, { passive: true });
  view?.addEventListener("resize", measure);
  measure();
  return () => {
    active = false;
    resize?.disconnect();
    mutation?.disconnect();
    container.removeEventListener("scroll", measure);
    view?.removeEventListener("resize", measure);
  };
}
