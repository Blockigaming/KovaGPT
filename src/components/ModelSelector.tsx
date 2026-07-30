import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MODES, modesForTier, type ModeId, type Tier } from "@/lib/modes";
import {
  KOVA_VERSIONS,
  getKovaVersion,
  setKovaVersion,
  type KovaVersion,
} from "@/lib/kova-version";

export function ModelSelector({
  mode,
  onChange,
  userTier = "free",
  compact = false,
}: {
  mode: ModeId;
  onChange: (m: ModeId) => void;
  userTier?: Tier;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<KovaVersion>("3.5");
  useEffect(() => {
    setVersion(getKovaVersion());
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Choose model: Kova ${version} ${current.label}`}
        data-testid="model-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full bg-accent/70 hover:bg-accent transition ${
          compact ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm"
        }`}
      >
        <span className="text-foreground font-medium leading-none tabular-nums">
          Kova {version}
          {version === "3.5" && (
            <span className="text-muted-foreground font-normal"> · {current.label}</span>
          )}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-56 rounded-xl border border-border bg-popover shadow-xl z-50 p-1 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150">
          {version === "3.5" && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Intelligence
              </div>
              {modesForTier(userTier).map((m) => {
                const selected = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`model-option-${m.id}`}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className="w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div
                      className={`w-full text-left px-3 py-2 rounded-lg transition flex items-center gap-2 ${selected ? "bg-accent" : "hover:bg-accent/60"}`}
                    >
                      <span className="font-medium text-sm flex-1">{m.label}</span>
                      {selected && <Check className="w-4 h-4 text-foreground" />}
                    </div>
                  </button>
                );
              })}
            </>
          )}
          <div className="mt-1 pt-2 border-t border-border">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Kova version
            </div>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {KOVA_VERSIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setKovaVersion(v);
                    setVersion(v);
                  }}
                  className={`text-[11px] px-2 py-1 rounded-full border transition ${
                    v === version
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-foreground border-border hover:bg-accent"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
