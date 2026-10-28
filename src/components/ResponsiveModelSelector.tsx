import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODES, versionGroupsForTier, type ModeId, type Tier } from "@/lib/modes";
import { modeDisplayLabel } from "@/lib/mode-display-label";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useUser } from "@/components/auth/ClerkSafe";
import { NovaLogo } from "@/components/NovaLogo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  // Signed-out and Free users never receive a switchable model picker.
  const locked = !isLoaded || !isSignedIn || userTier === "free";
  const useSheet = !isDesktop || interaction === "touch";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const groups = versionGroupsForTier(userTier);
  const current =
    groups.flatMap((group) => group.modes).find((item) => item.id === mode) ?? MODES[0];
  const topbar = placement === "topbar";

  // Signed-out and Free visitors are pinned to Instant even if stale local state
  // previously contained a paid/legacy mode.
  useEffect(() => {
    if (!isLoaded || (isSignedIn && userTier !== "free")) return;
    setOpen(false);
    if (mode !== "instant") onChange("instant");
  }, [isLoaded, isSignedIn, mode, onChange, userTier]);

  useEffect(() => {
    if (!open || topbar || useSheet) return;
    const trigger = triggerRef.current;
    const optionsPanel = trigger?.closest<HTMLElement>(".spec400-options-panel");
    if (!trigger || !optionsPanel) return;

    // A short Options panel can flip below the composer after its nested picker
    // opens. Its old scroll position then leaves the model trigger offscreen,
    // and Radix follows that trigger with a clipped menu. Keep the trigger in
    // the panel's visible viewport whenever either popover moves.
    const keepTriggerVisible = () => {
      const anchor = trigger.getBoundingClientRect();
      const panel = optionsPanel.getBoundingClientRect();
      const top = Math.max(panel.top, 12);
      const bottom = Math.min(panel.bottom, window.innerHeight - 12);
      if (anchor.bottom > bottom) optionsPanel.scrollTop += anchor.bottom - bottom;
      else if (anchor.top < top) optionsPanel.scrollTop += anchor.top - top;
    };
    const observer = new IntersectionObserver(keepTriggerVisible, { threshold: 1 });
    observer.observe(trigger);
    keepTriggerVisible();
    return () => observer.disconnect();
  }, [open, topbar, useSheet]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const triggerClass =
    "kova-model-trigger inline-flex min-h-11 max-w-full items-center gap-2 py-2 font-medium transition-colors duration-100 [font-family:var(--font-ui,var(--font-sans))] " +
    (topbar
      ? useSheet
        ? "rounded-full bg-transparent px-3 text-[15px] active:bg-accent"
        : "rounded-full bg-transparent px-3 text-[15px] hover:bg-accent"
      : "rounded-full bg-transparent " +
        (useSheet ? "active:bg-accent " : "hover:bg-accent ") +
        (compact ? "px-3 text-sm" : "px-4 text-[15px]"));

  const renderOption = (availableMode: (typeof MODES)[number]) => {
    const selected = availableMode.id === mode;
    return (
      <button
        key={availableMode.id}
        type="button"
        data-slot="model-selector-option"
        data-kova-button-shape="preserve"
        aria-pressed={selected}
        onClick={() => {
          onChange(availableMode.id);
          closeAndRestoreFocus();
        }}
        className="min-h-11 w-full rounded-[var(--kova-radius-compact)] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [font-family:var(--font-ui,var(--font-sans))]"
        data-testid={"model-option-" + availableMode.id}
      >
        <div
          className={
            useSheet
              ? "flex min-h-11 w-full items-center gap-3 rounded-[var(--kova-radius-compact)] px-4 py-3 text-left " +
                (selected ? "bg-accent" : "hover:bg-accent/60 active:bg-accent")
              : "flex min-h-11 w-full items-center gap-2 rounded-[var(--kova-radius-compact)] px-3 py-2.5 text-left transition-colors duration-100 " +
                (selected ? "bg-accent" : "hover:bg-accent/60")
          }
        >
          <span className="flex-1 text-[15px] font-medium">{modeDisplayLabel(availableMode)}</span>
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

  const options = groups.map((group) => (
    <div key={group.id} className="pb-2">
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
        {group.label.replace(/^KovaGPT(?=\s|$)/u, "Kova GPT")}
      </div>
      {group.modes.map(renderOption)}
    </div>
  ));

  // Guests and Free users see the brand label in the same position, but no switchable menu.
  if (locked)
    return (
      <span
        data-slot="model-selector-label"
        className="kova-model-static inline-flex min-h-11 min-w-0 select-none items-center gap-2 px-3 text-[15px] font-semibold tracking-[-0.015em] text-foreground [font-family:var(--font-ui,var(--font-sans))]"
      >
        <NovaLogo decorative className="h-6 w-6" />
        <span className="truncate leading-none">Kova GPT</span>
      </span>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex min-w-0">
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            onClick={
              useSheet
                ? (event) => {
                    event.preventDefault();
                    setOpen(true);
                  }
                : undefined
            }
            aria-haspopup="dialog"
            aria-label={"Choose model: Kova GPT " + modeDisplayLabel(current)}
            aria-expanded={open}
            aria-controls={!useSheet && open ? menuId : undefined}
            data-testid="model-selector-trigger"
            data-slot="model-selector-trigger"
            className={triggerClass}
          >
            {topbar ? <NovaLogo decorative className="h-6 w-6" /> : null}
            <span className={(useSheet ? "truncate " : "") + "leading-none text-muted-foreground"}>
              {compact ? (
                modeDisplayLabel(current)
              ) : (
                <>
                  Kova GPT<span className="ml-1 font-normal">· {modeDisplayLabel(current)}</span>
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
        </PopoverTrigger>

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
          <PopoverContent
            ref={contentRef}
            id={menuId}
            role="dialog"
            aria-label="Choose model"
            data-slot="model-selector-content"
            side={topbar ? "bottom" : "top"}
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="kova-model-menu flex w-72 max-w-[calc(100vw-24px)] flex-col rounded-[var(--kova-radius-menu)] border border-border bg-popover p-2 shadow-[var(--shadow-floating)] [font-family:var(--font-ui,var(--font-sans))]"
            style={{
              overflow: "hidden",
              // A composer trigger sits near mid-screen. Keep this menu short
              // enough for either side so Radix does not flip it after scrolling.
              maxHeight: topbar
                ? undefined
                : "min(36dvh, var(--radix-popover-content-available-height, 36dvh))",
            }}
            onOpenAutoFocus={(event) => {
              // The menu is portalled out of the Options scroll container.
              // Begin at the selected option without replacing the trigger.
              const selected =
                contentRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
              if (!selected) return;
              event.preventDefault();
              selected.focus({ preventScroll: true });
            }}
          >
            <div className="shrink-0 px-3 pb-1.5 pt-2 text-xs font-medium text-muted-foreground">
              Intelligence
            </div>
            <div
              data-testid="model-options-scroll"
              className="min-h-0 overflow-y-auto overscroll-contain"
            >
              {options}
            </div>
          </PopoverContent>
        )}
      </div>
    </Popover>
  );
}
