import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect, useId } from "react";
import { MODES, modesForTier, type ModeId, type Tier } from "@/lib/modes";

export function ModelSelector({
  mode,
  onChange,
  userTier = "free",
  compact = false,
  placement = "composer",
}: {
  mode: ModeId;
  onChange: (m: ModeId) => void;
  userTier?: Tier;
  compact?: boolean;
  placement?: "composer" | "topbar";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const topbar = placement === "topbar";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      className="kova-model-selector relative"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={"Choose model: KovaGPT " + current.label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="model-selector-trigger"
        onClick={() => setOpen((value) => !value)}
        className={
          "kova-model-trigger inline-flex items-center gap-1.5 font-medium transition " +
          (topbar
            ? "h-10 rounded-lg bg-transparent px-2.5 text-[15px] hover:bg-accent"
            : "rounded-full bg-accent/70 hover:bg-accent " +
              (compact ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm"))
        }
      >
        <span className="text-foreground leading-none">
          KovaGPT
          <span className="ml-1 text-muted-foreground font-normal">· {current.label}</span>
        </span>
        <ChevronDown
          className={
            "w-4 h-4 text-muted-foreground transition-transform " + (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Choose model"
          className={
            "kova-model-menu absolute left-0 z-50 w-64 rounded-2xl border border-border bg-popover p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 " +
            (topbar ? "top-full mt-1 origin-top-left" : "bottom-full mb-2 origin-bottom-left")
          }
        >
          <div className="px-3 pt-2 pb-1.5 text-xs font-medium text-muted-foreground">
            Choose how KovaGPT responds
          </div>
          {modesForTier(userTier).map((availableMode) => {
            const selected = availableMode.id === mode;
            return (
              <button
                key={availableMode.id}
                type="button"
                aria-pressed={selected}
                data-testid={"model-option-" + availableMode.id}
                onClick={() => {
                  onChange(availableMode.id);
                  setOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                className="w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={
                    "w-full text-left px-3 py-2.5 rounded-xl transition flex items-center gap-2 " +
                    (selected ? "bg-accent" : "hover:bg-accent/60")
                  }
                >
                  <span className="font-medium text-sm flex-1">{availableMode.label}</span>
                  {selected && <Check className="w-4 h-4 text-foreground" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
