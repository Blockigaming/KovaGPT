import { useRef, useState } from "react";

const clamp = (width: number) => Math.round(Math.min(440, Math.max(200, width)));

export function SettingsNavigationResize({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; value: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const restore = (element: HTMLElement) => {
    element.parentElement?.style.removeProperty("--kova-settings-navigation-width");
    element.parentElement?.removeAttribute("data-resizing");
    drag.current = null;
    setDraft(null);
  };
  return (
    <div
      className="kova-settings-navigation-resize"
      role="separator"
      tabIndex={0}
      aria-label="Resize settings navigation"
      aria-orientation="vertical"
      aria-valuemin={200}
      aria-valuemax={440}
      aria-valuenow={draft ?? width}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowRight"
            ? width + 10
            : event.key === "ArrowLeft"
              ? width - 10
              : event.key === "Home"
                ? 200
                : event.key === "End"
                  ? 440
                  : null;
        if (next === null) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, value: width };
        event.currentTarget.parentElement?.setAttribute("data-resizing", "");
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const parent = event.currentTarget.parentElement;
        const max = Math.min(440, (parent?.clientWidth ?? 784) - 344);
        const value = clamp(Math.min(max, drag.current.width + event.clientX - drag.current.x));
        drag.current.value = value;
        setDraft(value);
        parent?.style.setProperty("--kova-settings-navigation-width", `${value}px`);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        onChange(drag.current.value);
        restore(event.currentTarget);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => restore(event.currentTarget)}
      onLostPointerCapture={(event) => restore(event.currentTarget)}
    >
      <span />
    </div>
  );
}
