import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { BrowserResult, BrowserVisualInput } from "@/lib/work-browser-transport.mjs";

const remoteKeys = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
]);

export function WorkBrowserViewport({
  frame,
  enabled,
  onInput,
}: {
  frame: NonNullable<BrowserResult["frame"]>;
  enabled: boolean;
  onInput: (input: BrowserVisualInput) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  function coordinates(event: PointerEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        frame.width - 1,
        Math.floor(((event.clientX - bounds.left) / bounds.width) * frame.width),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        frame.height - 1,
        Math.floor(((event.clientY - bounds.top) / bounds.height) * frame.height),
      ),
    );
    return { frame: frame.id, x, y };
  }

  function scroll(
    event: PointerEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>,
    x: number,
    y: number,
  ) {
    const normalize = (value: number) => Math.max(-900, Math.min(900, Math.round(value)));
    const deltaX = normalize(x),
      deltaY = normalize(y);
    if (deltaX || deltaY) onInput({ kind: "scroll", ...coordinates(event), deltaX, deltaY });
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!enabled || event.nativeEvent.isComposing) return;
    let key = event.key;
    if (key === "Tab") {
      if (!event.altKey) return;
      key = event.shiftKey ? "Shift+Tab" : "Tab";
    } else if (event.ctrlKey || event.metaKey) {
      if (key.toLowerCase() !== "a") return;
      key = "ControlOrMeta+A";
    } else if (event.altKey || !remoteKeys.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    onInput({ kind: "key", key });
  }

  return (
    <div className="work-browser-viewport">
      <div className="work-browser-screen">
        <img
          alt="Live browser page"
          src={`data:image/jpeg;base64,${frame.jpeg}`}
          width={frame.width}
          height={frame.height}
          draggable={false}
          onPointerDown={(event) => {
            if (!enabled || !event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            if (event.pointerType === "touch") {
              touch.current = { x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            touch.current = null;
          }}
          onPointerUp={(event) => {
            if (!enabled || !event.isPrimary || event.button !== 0) return;
            const start = touch.current;
            touch.current = null;
            if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 12) {
              scroll(event, start.x - event.clientX, start.y - event.clientY);
              return;
            }
            input.current?.focus({ preventScroll: true });
            onInput({ kind: "click", ...coordinates(event) });
          }}
          onWheel={(event) => {
            if (!enabled || event.ctrlKey) return;
            const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1;
            scroll(event, event.deltaX * scale, event.deltaY * scale);
          }}
        />
        <textarea
          ref={input}
          aria-label="Type into the live browser"
          className="work-browser-keyboard"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={!enabled}
          onKeyDown={keyDown}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (enabled && text) onInput({ kind: "input", text });
          }}
          onCompositionEnd={(event) => {
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (enabled && text) onInput({ kind: "input", text });
          }}
        />
      </div>
    </div>
  );
}
