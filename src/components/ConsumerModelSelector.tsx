import { useRef, useState } from "react";
import { Check, ChevronDown, LockKeyhole } from "lucide-react";
import {
  CONSUMER_MODELS,
  consumerModel,
  type ConsumerModelId,
} from "@/lib/consumer-model-selection.mjs";
import { useLayout } from "@/hooks/use-mobile";
import { useUser } from "@/components/auth/ClerkSafe";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Tier } from "@/lib/modes";

/** Selecting a foundation prepares the next request; it never sends a message. */
export function ConsumerModelSelector({
  value,
  onChange,
  tier,
  disabled = false,
}: {
  value: ConsumerModelId;
  onChange: (value: ConsumerModelId) => void;
  tier: Tier;
  disabled?: boolean;
}) {
  const { isDesktop, interaction } = useLayout();
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = !isDesktop || interaction === "touch";
  const current = consumerModel(value);
  const locked = disabled || !isLoaded || !isSignedIn;
  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const options = (
    <div className="flex min-w-0 flex-col gap-1">
      {CONSUMER_MODELS.map((model) => {
        const entitled = model.tiers.includes(tier);
        const selected = value === model.id;
        return (
          <button
            key={model.id}
            type="button"
            aria-pressed={selected}
            disabled={locked || !entitled}
            data-testid={`consumer-model-${model.id}`}
            onClick={() => {
              if (locked || !entitled) return;
              onChange(model.id);
              close();
            }}
            className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{model.label}</span>
              <span className="block text-xs text-muted-foreground">
                {model.description}
                {!entitled ? ` · ${model.tiers[0] === "plus" ? "Plus" : "Pro"} required` : ""}
              </span>
            </span>
            {!entitled ? (
              <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : selected ? (
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
      {tier !== "pro" ? (
        <a
          href="/pricing"
          className="mt-1 rounded-xl px-3 py-2 text-sm underline underline-offset-4"
        >
          Compare plans
        </a>
      ) : null}
    </div>
  );
  return (
    <Popover open={open && !locked} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          disabled={locked}
          aria-label={`Choose Kova model: ${current?.label ?? "Unavailable"}`}
          aria-haspopup="dialog"
          aria-expanded={open && !locked}
          data-testid="consumer-model-trigger"
          onClick={
            sheet
              ? (event) => {
                  event.preventDefault();
                  setOpen(true);
                }
              : undefined
          }
          className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl px-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <span className="truncate">{current?.label ?? "Model unavailable"}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {sheet ? (
        <MobileBottomSheet
          open={open && !locked}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
          title="Kova models"
          ariaLabel="Choose Kova model"
        >
          {options}
        </MobileBottomSheet>
      ) : (
        <PopoverContent
          role="dialog"
          aria-label="Choose Kova model"
          side="top"
          align="start"
          collisionPadding={12}
          className="w-72 max-w-[calc(100vw-24px)] rounded-2xl p-2"
        >
          {options}
        </PopoverContent>
      )}
    </Popover>
  );
}
