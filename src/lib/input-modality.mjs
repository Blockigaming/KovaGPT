// Focus restoration and portalled menus can match :focus-visible after pointer
// activation. Track the actual input method instead of removing keyboard focus.
export function installInputModality(document) {
  const root = document.documentElement;
  const previous = root.getAttribute("data-kova-input-modality");
  const set = (mode) => root.setAttribute("data-kova-input-modality", mode);
  const pointer = () => set("pointer");
  const keyboard = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const editing = event.target?.matches?.('input, textarea, [contenteditable="true"]');
    if (
      event.key === "Tab" ||
      (!editing &&
        [
          "Enter",
          " ",
          "Escape",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key))
    )
      set("keyboard");
  };
  set("keyboard");
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    if (previous === null) root.removeAttribute("data-kova-input-modality");
    else root.setAttribute("data-kova-input-modality", previous);
  };
}
