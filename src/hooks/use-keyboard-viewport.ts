import { useEffect } from "react";
import { composerKeyboardInset } from "@/lib/composer-keyboard-inset.mjs";

/** Expose the visible viewport while a compact text field owns the keyboard. */
export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    const compact = window.matchMedia("(width < 1024px)");
    let frame = 0;
    const update = () => {
      const focused = document.activeElement;
      const keyboardField =
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLInputElement &&
          focused.matches(
            ':is([type="text"], [type="search"], [type="email"], [type="password"], [type="url"], [type="tel"], [type="number"], input:not([type]))',
          )) ||
        (focused instanceof HTMLElement && focused.isContentEditable);
      const keyboardInset = composerKeyboardInset({
        layoutHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportTop: 0,
        scale: viewport.scale,
        focused: compact.matches && keyboardField,
      });
      root.toggleAttribute("data-kova-keyboard", keyboardInset > 0);
      if (keyboardInset > 0) {
        root.style.setProperty("--kova-visible-height", `${viewport.height}px`);
        root.style.setProperty("--kova-visible-top", `${viewport.offsetTop}px`);
      } else {
        root.style.removeProperty("--kova-visible-height");
        root.style.removeProperty("--kova-visible-top");
      }

      const shell = document.querySelector<HTMLElement>('.kova-assistant[data-ui="modern"]');
      if (shell) {
        const keyboardOpen =
          keyboardInset > 0 &&
          focused instanceof HTMLTextAreaElement &&
          shell.contains(focused) &&
          Boolean(focused.closest(".spec400-chat-input"));
        if (keyboardOpen) shell.dataset.keyboardOpen = "true";
        else delete shell.dataset.keyboardOpen;
      }
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const dismissFromCanvas = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        !root.hasAttribute("data-kova-keyboard") ||
        !(event.target instanceof Element) ||
        document.getSelection()?.toString()
      )
        return;
      const canvas = event.target.closest(".kova-conversation-scroll, .kova-empty-chat");
      const control = event.target.closest(
        "a, button, input, textarea, select, label, [role=button], [role=link], [tabindex], [contenteditable]",
      );
      if (!canvas || (control !== canvas && canvas.contains(control))) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };

    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("click", dismissFromCanvas);
    compact.addEventListener("change", scheduleUpdate);
    document.addEventListener("focusin", scheduleUpdate);
    document.addEventListener("focusout", scheduleUpdate);
    update();

    return () => {
      cancelAnimationFrame(frame);
      root.removeAttribute("data-kova-keyboard");
      root.style.removeProperty("--kova-visible-height");
      root.style.removeProperty("--kova-visible-top");
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("click", dismissFromCanvas);
      compact.removeEventListener("change", scheduleUpdate);
      document.removeEventListener("focusin", scheduleUpdate);
      document.removeEventListener("focusout", scheduleUpdate);
    };
  }, []);
}
