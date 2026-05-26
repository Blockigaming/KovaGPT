import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MODES, type ModeId } from "@/lib/modes";

export function ModelSelector({ mode, onChange }: { mode: ModeId; onChange: (m: ModeId) => void }) {
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-accent transition font-semibold"
      >
        Nova GPT
        <span className="text-xs text-muted-foreground font-normal ml-1">· {current.label}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-0 w-72 rounded-xl border border-border bg-popover shadow-xl z-50 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-accent transition flex items-start gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.description}</div>
              </div>
              {m.id === mode && <Check className="w-4 h-4 mt-0.5 text-foreground" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
