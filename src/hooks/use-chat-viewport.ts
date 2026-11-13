import { useEffect, useRef } from "react";
import { composerKeyboardInset } from "@/lib/composer-keyboard-inset.mjs";

/** Give the chat shell the visible viewport while its input owns the keyboard. */
export function useChatViewport() {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;

    const compact = window.matchMedia("(width < 1024px)");
    let frame = 0;
    const update = () => {
      const focused = document.activeElement;
      const inset = composerKeyboardInset({
        layoutHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportTop: viewport.offsetTop,
        scale: viewport.scale,
        focused:
          compact.matches &&
          focused instanceof HTMLTextAreaElement &&
          shell.contains(focused) &&
          Boolean(focused.closest(".spec400-chat-input")),
      });

      if (inset > 0) {
        shell.style.setProperty("--chat-visible-height", `${viewport.height}px`);
        shell.style.setProperty("--chat-visible-top", `${viewport.offsetTop}px`);
        shell.dataset.keyboardOpen = "true";
      } else {
        shell.style.removeProperty("--chat-visible-height");
        shell.style.removeProperty("--chat-visible-top");
        delete shell.dataset.keyboardOpen;
      }
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    compact.addEventListener("change", scheduleUpdate);
    shell.addEventListener("focusin", scheduleUpdate);
    shell.addEventListener("focusout", scheduleUpdate);
    update();

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      compact.removeEventListener("change", scheduleUpdate);
      shell.removeEventListener("focusin", scheduleUpdate);
      shell.removeEventListener("focusout", scheduleUpdate);
    };
  }, []);

  return shellRef;
}
