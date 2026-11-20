import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import {
  CONSUMER_MODELS,
  DEFAULT_CONSUMER_MODEL,
  consumerModel,
  type ConsumerModelId,
} from "@/lib/consumer-model-selection.mjs";
import { useUser } from "@/components/auth/ClerkSafe";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isModeAllowedForTier, modesForTier, type ModeId, type Tier } from "@/lib/modes";

const optionClass =
  "kova-consumer-model-option flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/** Model and effort choices prepare the next request without submitting the draft. */
export function ConsumerModelSelector({
  value,
  onChange,
  mode,
  onModeChange,
  tier,
  disabled = false,
  intelligenceOpen = false,
  onIntelligenceOpenChange,
}: {
  value: ConsumerModelId;
  onChange: (value: ConsumerModelId) => void;
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
  tier: Tier;
  disabled?: boolean;
  intelligenceOpen?: boolean;
  onIntelligenceOpenChange?: (open: boolean) => void;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; bounds: DOMRect } | null>(null);
  const thumbRail = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
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
  const isDefault = value === DEFAULT_CONSUMER_MODEL && effort.id === "instant";
  const modelLabel = isDefault ? "Default" : (consumerModel(value)?.label ?? "Model unavailable");
  const recommended = consumerModel(DEFAULT_CONSUMER_MODEL)?.label;
  const lastEffortIndex = efforts.length - 1;

  function slide(event: PointerEvent<HTMLInputElement>) {
    if (locked || drag.current?.pointerId !== event.pointerId) return;
    const { left, width } = drag.current.bounds;
    const position = Math.min(1, Math.max(0, (event.clientX - left) / width));
    setDragPosition(position);
    const next = efforts[Math.round(position * lastEffortIndex)];
    if (next.id !== effort.id) onModeChange(next.id);
  }

  function finishDrag() {
    drag.current = null;
    setDragPosition(null);
  }

  return (
    <>
      <Dialog open={intelligenceOpen && !locked} onOpenChange={onIntelligenceOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[min(80dvh,32rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            modelTrigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>Intelligence</DialogTitle>
          <div role="group" aria-label="Available models" className="flex flex-wrap gap-2">
            {availableModels.map((model) => (
              <button
                key={model.id}
                type="button"
                aria-pressed={value === model.id}
                className="min-h-11 rounded-full border border-border px-3 text-sm aria-pressed:bg-foreground aria-pressed:text-background"
                onClick={() => onChange(model.id)}
              >
                {model.label}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="Response effort"
            className="grid gap-1 rounded-2xl bg-accent/50 p-1"
          >
            {[...efforts].reverse().map((level) => (
              <button
                key={level.id}
                type="button"
                aria-pressed={level.id === mode}
                className={`${optionClass} min-h-11 aria-pressed:bg-accent`}
                onClick={() => {
                  onModeChange(level.id);
                  onIntelligenceOpenChange?.(false);
                }}
              >
                <span className="flex-1">{level.label}</span>
                {level.id === mode && <Check className="size-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Popover
        open={open && !locked}
        onOpenChange={(next) => {
          if (!next) finishDrag();
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={locked}
            ref={modelTrigger}
            aria-label={`Choose model and effort, ${modelLabel} ${effort.label}`}
            data-testid="model-selector-trigger"
            data-slot="model-selector-trigger"
            data-ui-reference="chatgpt-model-selector"
            className="kova-model-trigger kova-consumer-model-trigger inline-flex min-w-0 max-w-40 items-center gap-1.5 bg-accent/50 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-[state=open]:bg-accent sm:max-w-52"
          >
            <span className="truncate">{modelLabel.replace(/^Kova /, "")}</span>
            <span className="shrink-0 text-muted-foreground">{effort.label}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-labelledby={titleId}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="kova-consumer-model-menu p-1.5"
        >
          <h2 id={titleId} className="shrink-0 px-3 py-1 text-xs font-medium text-muted-foreground">
            Select model
          </h2>
          <div className="kova-consumer-model-options" role="group" aria-label="Available models">
            <button
              type="button"
              className={optionClass}
              aria-pressed={isDefault}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                onChange(DEFAULT_CONSUMER_MODEL);
                onModeChange("instant");
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Default</span>
                <span className="block text-xs text-muted-foreground">
                  Recommended · {recommended}
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
                    onChange(model.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1">{model.label}</span>
                  {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
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
                  <span key={level.id} data-slot="effort-tick" data-filled={index <= effortIndex} />
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
                  drag.current = { pointerId: event.pointerId, bounds };
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
                  if (next) onModeChange(next.id);
                }}
              />
            </div>
            <button
              type="button"
              className="kova-effort-reset absolute right-1.5 top-2 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Reset response effort to Lite"
              title="Reset to Lite"
              disabled={locked}
              onClick={() => {
                if (!locked) onModeChange("instant");
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
