import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODES, versionGroupsForTier, type ModeId, type Tier } from "@/lib/modes";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useUser } from "@/components/auth/ClerkSafe";

/**
 * Adaptive model selector with a stable trigger element.
 *
 * The interaction mode is detected after hydration. Keeping the trigger in
 * the same React position prevents a keyboard-focused desktop trigger from
 * being replaced when a touch-capable 1024px device is detected.
 */
export function ResponsiveModelSelector({
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
  const { isDesktop, interaction } = useLayout();
  const { isSignedIn, isLoaded } = useUser();
  // Hidden until auth confirms a session: guests must never see the picker.
  const locked = !isSignedIn;
  const useSheet = !isDesktop || interaction === "touch";
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const topbar = placement === "topbar";

  useEffect(() => {
    if (useSheet || !open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open, useSheet]);

  // Signed-out visitors are pinned to the cheapest mode and never see the picker.
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    setOpen(false);
    if (mode !== "instant") onChange("instant");
  }, [isLoaded, isSignedIn, mode, onChange]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const triggerClass =
    "kova-model-trigger inline-flex items-center gap-1 font-medium transition-colors duration-100 " +
    (topbar
      ? useSheet
        ? "h-11 max-w-full rounded-lg bg-transparent px-2 text-[15px] active:bg-accent"
        : "h-10 rounded-lg bg-transparent px-2.5 text-[15px] hover:bg-accent"
      : "rounded-lg bg-transparent " +
        (useSheet ? "active:bg-accent " : "hover:bg-accent ") +
        (compact ? "h-8 px-3.5 text-sm" : "h-9 px-4 text-[15px]"));

  const renderOption = (availableMode: (typeof MODES)[number]) => {
    const selected = availableMode.id === mode;
    return (
      <button
        key={availableMode.id}
        type="button"
        aria-pressed={selected}
        onClick={() => {
          onChange(availableMode.id);
          closeAndRestoreFocus();
        }}
        className={
          useSheet ? "w-full" : "w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
        data-testid={"model-option-" + availableMode.id}
      >
        <div
          className={
            useSheet
              ? "flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left " +
                (selected ? "bg-accent" : "hover:bg-accent/60 active:bg-accent")
              : "flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left transition-colors duration-100 " +
                (selected ? "bg-accent" : "hover:bg-accent/60")
          }
        >
          <span className="flex-1 text-[15px] font-medium">{availableMode.label}</span>
          {selected && (
            <Check
              className={useSheet ? "h-5 w-5" : "h-4 w-4 text-foreground"}
              aria-label={useSheet ? "Selected" : undefined}
            />
          )}
        </div>
      </button>
    );
  };

  const groups = versionGroupsForTier(userTier);
  const options = groups.map((group) => (
    <div key={group.id} className="pb-1">
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label}</div>
      {group.modes.map(renderOption)}
    </div>
  ));

  // Guests see the brand label in the same position, but no switchable menu.
  if (locked)
    return (
      <span className="kova-model-static inline-flex h-10 select-none items-center px-2.5 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
        <span className="leading-none">KovaGPT</span>
      </span>
    );

  return (
    <div
      ref={containerRef}
      className="relative inline-flex min-w-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        closeAndRestoreFocus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => (useSheet ? true : !value))}
        aria-haspopup="dialog"
        aria-label={"Choose model: KovaGPT " + current.label}
        aria-expanded={open}
        aria-controls={!useSheet && open ? menuId : undefined}
        data-testid="model-selector-trigger"
        className={triggerClass}
      >
        <span className={(useSheet ? "truncate " : "") + "leading-none text-muted-foreground"}>
          {compact ? (
            current.label
          ) : (
            <>
              KovaGPT<span className="ml-1 font-normal">· {current.label}</span>
            </>
          )}
        </span>

        <ChevronDown
          className={
            "h-4 w-4 text-muted-foreground transition-transform " +
            (!useSheet && open ? "rotate-180" : "")
          }
        />
      </button>

      {useSheet ? (
        <MobileBottomSheet
          open={open}
          onOpenChange={(next) => {
            if (next) setOpen(true);
            else closeAndRestoreFocus();
          }}
          title="Intelligence"
          ariaLabel="Choose model"
        >
          <div className="flex flex-col gap-1">{options}</div>
        </MobileBottomSheet>
      ) : (
        open && (
          <div
            id={menuId}
            role="dialog"
            aria-label="Choose model"
            className={
              "kova-model-menu absolute left-0 z-50 w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg animate-in fade-in-0 duration-100 " +
              (topbar ? "top-full mt-1 origin-top-left" : "bottom-full mb-2 origin-bottom-left")
            }
          >
            <div className="px-3 pb-1.5 pt-2 text-xs font-medium text-muted-foreground">
              Intelligence
            </div>

            {options}
          </div>
        )
      )}
    </div>
  );
}
