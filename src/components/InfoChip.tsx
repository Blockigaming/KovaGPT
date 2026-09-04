// Small dark rounded card used to present short, factual snippets like the
// current time or a location. Renders a rich visual widget (analog clock or
// map) plus a Copy button so the user can pull the text into their notes.
import { Clock, MapPin, Copy, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ClockWidget } from "./ClockWidget";
import { MapWidget } from "./MapWidget";
import type { ChipKind } from "./info-chip-utils";

export function InfoChip({
  kind,
  children,
  rawText,
  userKey,
  principalResolved,
}: {
  kind: ChipKind;
  children: ReactNode;
  rawText?: string;
  userKey: string | null;
  principalResolved: boolean;
}) {
  const Icon = kind === "time" ? Clock : MapPin;
  const label = kind === "time" ? "Time" : "Location";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      const text = rawText ?? (typeof children === "string" ? children : "");
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy this card. Check your browser's clipboard permission.");
    }
  };

  return (
    <div className="my-3 rounded-2xl border border-white/5 bg-[#0a0a0a] text-neutral-100 shadow-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
          <Icon className="w-3.5 h-3.5" />
          <span>{label}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          title={copied ? "Copied" : "Copy"}
          aria-label={copied ? "Copied" : "Copy card"}
          className="-mr-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="px-4 pb-4 pt-2 flex items-center gap-4">
        {kind === "time" ? <ClockWidget size={72} /> : null}
        <div className="prose-chat prose-invert max-w-none text-neutral-100 text-[15px] leading-relaxed flex-1 min-w-0">
          {children}
          {kind === "time" && (
            <div className="mt-1 text-[12px] text-neutral-500">
              {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")} ·{" "}
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
          )}
        </div>
      </div>

      {kind === "location" && (
        <div className="px-4 pb-4">
          <MapWidget height={180} userKey={userKey} principalResolved={principalResolved} />
        </div>
      )}
    </div>
  );
}
