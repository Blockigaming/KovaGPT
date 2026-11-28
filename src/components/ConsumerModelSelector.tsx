import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Check, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import {
  CONSUMER_MODELS,
  DEFAULT_CONSUMER_MODEL,
  consumerModel,
  type ConsumerModelId,
} from "@/lib/consumer-model-selection.mjs";
import { useUser } from "@/components/auth/ClerkSafe";
import { MobileIntelligence } from "./MobileIntelligence";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isModeAllowedForTier, modesForTier, type ModeId, type Tier } from "@/lib/modes";

const optionClass =
  "kova-consumer-model-option flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

const recommendedModels: Partial<Record<ModeId, ConsumerModelId>> = {
  instant: DEFAULT_CONSUMER_MODEL,
  thinking: "kova-neon-4.6",
  high: "kova-xenon-5",
  extra_high: "kova-xenon-5",
  max: "kova-xenon-6.1",
  ultra: "kova-xenon-6.1",
};

/** Model and effort choices prepare the next request without submitting the draft. */
export function ConsumerModelSelector({
  value,
  onChange,
  recommendedSelection,
  mode,
  onModeChange,
  tier,
  disabled = false,
  intelligenceOpen = false,
  onIntelligenceOpenChange,
}: {
  value: ConsumerModelId;
  onChange: (value: ConsumerModelId, recommended?: boolean) => void;
  recommendedSelection: boolean;
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
  tier: Tier;
  disabled?: boolean;
  intelligenceOpen?: boolean;
  onIntelligenceOpenChange?: (open: boolean) => void;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [showModels, setShowModels] = useState(false);
  // On phones the popup sits directly above the chat bar: measure the bar's
  // top edge when it opens; the stylesheet positions the popup from that value.
  useEffect(() => {
    if (!open) return;
    const composer = Array.from(document.querySelectorAll<HTMLElement>(".spec400-composer")).find(
      (element) => element.getClientRects().length > 0,
    );
    if (!composer) return;
    const box = composer.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty("--kova-composer-top", `${Math.round(box.top)}px`);
    root.setProperty("--kova-composer-left", `${Math.round(box.left)}px`);
    root.setProperty("--kova-composer-right", `${Math.round(window.innerWidth - box.right)}px`);
    root.setProperty("--kova-composer-radius", getComputedStyle(composer).borderTopLeftRadius);
  }, [open]);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; bounds: DOMRect; recommended: boolean } | null>(null);
  const thumbRail = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const modelViewToggle = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const effortId = useId();
  const locked = disabled || !isLoaded || !isSignedIn || tier === "free";
  const validEffort = isModeAllowedForTier(tier, mode);

  useEffect(() => {
    if (locked || !validEffort) setOpen(false);
    if (!locked && !validEffort) onModeChange("instant");
  }, [locked, onModeChange, validEffort]);

  if (tier === "free") return null;

  const efforts = modesForTier(tier);
  const availableModels = CONSUMER_MODELS.filter((model) => model.tiers.includes(tier));
  const effortIndex = Math.max(
    0,
    efforts.findIndex((effort) => effort.id === mode),
  );
  const effort = efforts[effortIndex];
  const recommendedModelFor = (id: ModeId) =>
    availableModels.find((model) => model.id === recommendedModels[id])?.id ??
    DEFAULT_CONSUMER_MODEL;
  const isDefault = recommendedSelection;
  const modelLabel =
    availableModels.find((model) => model.id === value)?.label ??
    consumerModel(DEFAULT_CONSUMER_MODEL)!.label;
  const selectionLabel = `${modelLabel} ${effort.label}`;
  const recommended = consumerModel(DEFAULT_CONSUMER_MODEL)?.label;
  const lastEffortIndex = efforts.length - 1;

  function chooseModel(id: ConsumerModelId) {
    onChange(id);
  }

  function chooseEffort(id: ModeId) {
    if (drag.current?.recommended ?? isDefault) onChange(recommendedModelFor(id), true);
    onModeChange(id);
  }

  function resetToDefault() {
    if (locked) return;
    onChange(DEFAULT_CONSUMER_MODEL, true);
    onModeChange("instant");
    setShowModels(false);
    modelViewToggle.current?.focus();
  }

  function slide(event: PointerEvent<HTMLInputElement>) {
    if (locked || drag.current?.pointerId !== event.pointerId) return;
    const { left, width } = drag.current.bounds;
    const position = Math.min(1, Math.max(0, (event.clientX - left) / width));
    setDragPosition(position);
    const next = efforts[Math.round(position * lastEffortIndex)];
    if (next.id !== effort.id) chooseEffort(next.id);
  }

  function finishDrag() {
    drag.current = null;
    setDragPosition(null);
  }

  return (
    <>
      <MobileIntelligence
        open={intelligenceOpen && !locked}
        onOpenChange={onIntelligenceOpenChange}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          modelTrigger.current?.focus({ preventScroll: true });
        }}
        models={availableModels}
        value={value}
        onChange={chooseModel}
        mode={mode}
        onModeChange={chooseEffort}
        efforts={efforts}
      />
      <Popover
        open={open && !locked}
        onOpenChange={(next) => {
          if (!next) {
            finishDrag();
            setShowModels(false);
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={locked}
            ref={modelTrigger}
            aria-label={`Choose model and effort, ${selectionLabel}`}
            title={selectionLabel}
            data-testid="model-selector-trigger"
            data-slot="model-selector-trigger"
            data-ui-reference="chatgpt-model-selector"
            className="kova-model-trigger kova-consumer-model-trigger"
          >
            <span className="kova-consumer-model-pill">
              <span className="kova-consumer-model-text">
                {modelLabel.startsWith("Kova ") ? (
                  <>
                    <span className="kova-consumer-model-brand">Kova </span>
                    {modelLabel.slice(5)}
                  </>
                ) : (
                  modelLabel
                )}{" "}
                <span className="text-muted-foreground">{effort.label}</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-labelledby={titleId}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="kova-consumer-model-menu border-0 p-1.5"
        >
          <h2 id={titleId} className="sr-only">
            Select model
          </h2>
          <div className="flex items-center gap-0.5 pb-1">
            <button
              type="button"
              ref={modelViewToggle}
              onClick={() => setShowModels((visible) => !visible)}
              aria-expanded={showModels}
              className={`${optionClass} kova-consumer-model-view-toggle`}
              disabled={locked}
            >
              {showModels ? "Back to response effort" : "Select model"}
              <ChevronRight className="ml-auto size-4 shrink-0" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="kova-effort-reset shrink-0 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Reset to recommended model and Lite effort"
              title={`Reset to ${recommended} Lite`}
              disabled={locked}
              onClick={resetToDefault}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          {showModels ? (
            <div className="kova-consumer-model-options" role="group" aria-label="Available models">
              <button
                type="button"
                className={optionClass}
                aria-pressed={isDefault}
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  resetToDefault();
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Default</span>
                  <span className="block text-xs text-muted-foreground">
                    Recommended · {recommended} to Kova Xenon 6.1
                  </span>
                </span>
                {isDefault && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
              {availableModels.map((model) => {
                const selected = !isDefault && value === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={locked}
                    title={model.description}
                    data-testid={`consumer-model-${model.id}`}
                    className={optionClass}
                    onClick={() => {
                      if (locked) return;
                      chooseModel(model.id);
                      setShowModels(false);
                      modelViewToggle.current?.focus();
                    }}
                  >
                    <span className="min-w-0 flex-1">{model.label}</span>
                    {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="kova-effort-picker kova-consumer-effort relative">
              <div className="px-7 text-center">
                <div className="kova-consumer-effort-value text-sm font-semibold leading-5">
                  {effort.label}
                </div>
                <div className="truncate text-xs text-muted-foreground">{modelLabel}</div>
              </div>
              <label htmlFor={effortId} className="sr-only">
                Response effort
              </label>
              <div
                className="kova-effort-control"
                data-dragging={dragPosition !== null}
                style={
                  {
                    "--effort-position": `${(dragPosition ?? effortIndex / lastEffortIndex) * 100}%`,
                  } as CSSProperties
                }
              >
                <div className="kova-effort-track" data-slot="effort-track" aria-hidden="true">
                  <div className="kova-effort-fill" data-slot="effort-fill" />
                </div>
                <div ref={thumbRail} className="kova-effort-stops" aria-hidden="true">
                  {efforts.map((level, index) => (
                    <span
                      key={level.id}
                      data-slot="effort-tick"
                      data-filled={index <= effortIndex}
                    />
                  ))}
                  <span className="kova-consumer-effort-thumb" data-slot="effort-thumb" />
                </div>
                <input
                  id={effortId}
                  type="range"
                  className="kova-effort-range"
                  min={0}
                  max={lastEffortIndex}
                  step={1}
                  value={effortIndex}
                  aria-valuetext={effort.label}
                  disabled={locked}
                  onPointerDown={(event) => {
                    if (locked || event.button !== 0 || !event.isPrimary || !thumbRail.current)
                      return;
                    const bounds = thumbRail.current.getBoundingClientRect();
                    if (!bounds.width) return;
                    event.preventDefault();
                    event.currentTarget.focus({ preventScroll: true });
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { pointerId: event.pointerId, bounds, recommended: isDefault };
                    slide(event);
                  }}
                  onPointerMove={slide}
                  onPointerUp={(event) => {
                    if (drag.current?.pointerId !== event.pointerId) return;
                    slide(event);
                    finishDrag();
                  }}
                  onLostPointerCapture={(event) => {
                    if (drag.current?.pointerId === event.pointerId) finishDrag();
                  }}
                  onChange={(event) => {
                    if (locked) return;
                    const next = efforts[event.currentTarget.valueAsNumber];
                    if (next) chooseEffort(next.id);
                  }}
                />
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
