import { useEffect, useId, useState, type CSSProperties } from "react";
import { Check, ChevronDown, LockKeyhole, RotateCcw, Zap } from "lucide-react";
import {
  CONSUMER_MODELS,
  DEFAULT_CONSUMER_MODEL,
  consumerModel,
  type ConsumerModelId,
} from "@/lib/consumer-model-selection.mjs";
import { useUser } from "@/components/auth/ClerkSafe";
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
}: {
  value: ConsumerModelId;
  onChange: (value: ConsumerModelId) => void;
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
  tier: Tier;
  disabled?: boolean;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
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
  const effortIndex = Math.max(
    0,
    efforts.findIndex((effort) => effort.id === mode),
  );
  const effort = efforts[effortIndex];
  const isDefault = value === DEFAULT_CONSUMER_MODEL && effort.id === "instant";
  const modelLabel = isDefault ? "Default" : (consumerModel(value)?.label ?? "Model unavailable");
  const recommended = consumerModel(DEFAULT_CONSUMER_MODEL)?.label;

  return (
    <Popover open={open && !locked} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={locked}
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
        <h2 id={titleId} className="px-3 py-1 text-xs font-medium text-muted-foreground">
          Select model
        </h2>
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
            <span className="block text-xs text-muted-foreground">Recommended · {recommended}</span>
          </span>
          {isDefault && <Check className="size-4 shrink-0" aria-hidden="true" />}
        </button>
        <div className="kova-effort-picker kova-consumer-effort relative">
          <div className="kova-effort-header">
            <Zap className="kova-effort-icon" aria-hidden="true" />
            <div className="min-w-0 text-center">
              <div className="kova-consumer-effort-value text-sm font-semibold leading-5">
                {effort.label}
              </div>
              <div className="truncate text-xs text-muted-foreground">{modelLabel}</div>
            </div>
          </div>
          <label htmlFor={effortId} className="sr-only">
            Response effort
          </label>
          <div
            className="kova-effort-control"
            style={
              {
                "--effort-position": `${(effortIndex / (efforts.length - 1)) * 100}%`,
              } as CSSProperties
            }
          >
            <div className="kova-effort-track" data-slot="effort-track" aria-hidden="true">
              <div className="kova-effort-fill" data-slot="effort-fill" />
            </div>
            <div className="kova-effort-stops" aria-hidden="true">
              {efforts.map((level, index) => (
                <span key={level.id} data-slot="effort-tick" data-filled={index <= effortIndex} />
              ))}
            </div>
            <input
              id={effortId}
              type="range"
              className="kova-effort-range"
              min={0}
              max={efforts.length - 1}
              step={1}
              value={effortIndex}
              aria-valuetext={effort.label}
              disabled={locked}
              onChange={(event) => {
                const next = efforts[event.currentTarget.valueAsNumber];
                if (!locked && next) onModeChange(next.id);
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
        {CONSUMER_MODELS.map((model) => {
          const entitled = model.tiers.includes(tier);
          const selected = !isDefault && value === model.id;
          return (
            <button
              key={model.id}
              type="button"
              aria-pressed={selected}
              disabled={locked || !entitled}
              title={model.description}
              data-testid={`consumer-model-${model.id}`}
              className={optionClass}
              onClick={() => {
                if (locked || !entitled) return;
                onChange(model.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1">{model.label}</span>
              {!entitled ? (
                <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
              ) : selected ? (
                <Check className="size-4 shrink-0" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
