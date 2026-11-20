import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { ConsumerModelId } from "@/lib/consumer-model-selection.mjs";
import type { Mode } from "@/lib/modes";
import "./mobile-intelligence.css";

type Props = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  models: readonly { id: ConsumerModelId; label: string }[];
  value: ConsumerModelId;
  onChange: (id: ConsumerModelId) => void;
  mode: Mode["id"];
  onModeChange: (id: Mode["id"]) => void;
  efforts: readonly Mode[];
};

export function MobileIntelligence({
  open,
  onOpenChange,
  onCloseAutoFocus,
  models,
  value,
  onChange,
  mode,
  onModeChange,
  efforts,
}: Props) {
  const levels = [...efforts].reverse();
  const selected = Math.max(
    0,
    levels.findIndex((level) => level.id === mode),
  );
  const model = models.find((option) => option.id === value) ?? models[0];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="kova-intelligence-backdrop" />
        <Dialog.Content
          className="kova-intelligence-screen"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header>
            <Dialog.Title>Intelligence</Dialog.Title>
            <label className="kova-intelligence-model">
              <span className="sr-only">Available models</span>
              <select
                value={model.id}
                onChange={(event) => {
                  const next = models.find((option) => option.id === event.currentTarget.value);
                  if (next) onChange(next.id);
                }}
              >
                {models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </header>
          <div
            className="kova-intelligence-control"
            style={{ "--selected": selected } as CSSProperties}
          >
            <div className="kova-intelligence-labels" role="group" aria-label="Effort levels">
              {levels.map((level, index) => (
                <button
                  key={level.id}
                  type="button"
                  aria-pressed={index === selected}
                  onClick={() => onModeChange(level.id)}
                >
                  {model.label} {level.label}
                </button>
              ))}
            </div>
            <div className="kova-intelligence-rail">
              {levels.map(({ id }) => (
                <span className="kova-intelligence-stop" key={id} aria-hidden="true" />
              ))}
              <span className="kova-intelligence-thumb" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={levels.length - 1}
                value={selected}
                aria-label="Response effort"
                aria-orientation="vertical"
                aria-valuetext={levels[selected].label}
                onChange={(event) => onModeChange(levels[event.currentTarget.valueAsNumber].id)}
              />
            </div>
            <Dialog.Close className="kova-intelligence-close" aria-label="Close Intelligence">
              <X size={23} aria-hidden="true" />
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
