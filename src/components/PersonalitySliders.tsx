import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Lock, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTier, tierRank } from "@/hooks/useTier";

const TRAITS = [
  { key: "kindness", label: "Kindness", hint: "Warmer, softer replies" },
  { key: "formalness", label: "Formalness", hint: "Casual to formal" },
  { key: "humor", label: "Humor", hint: "Playful and witty" },
  { key: "directness", label: "Directness", hint: "Blunt vs cushioned" },
  { key: "detail", label: "Detail level", hint: "Brief vs thorough" },
  { key: "energy", label: "Energy", hint: "Calm vs enthusiastic" },
  { key: "creativity", label: "Creativity", hint: "Safe vs inventive" },
  { key: "friendliness", label: "Friendliness", hint: "Neutral vs warm" },
  { key: "seriousness", label: "Seriousness", hint: "Light vs serious" },
  { key: "conciseness", label: "Conciseness", hint: "Verbose vs terse" },
] as const;

type TraitKey = (typeof TRAITS)[number]["key"];
export type Personality = Record<TraitKey, number>;

const STORAGE_KEY = "kova.personality.v1";
const AUTO_KEY = "kova.personality.autoAdapt.v1";
export const DEFAULT_PERSONALITY: Personality = TRAITS.reduce(
  (acc, t) => ({ ...acc, [t.key]: 5 }),
  {} as Personality,
);

export const PERSONALITY_PRESETS: { id: string; label: string; hint: string; values: Personality }[] = [
  { id: "balanced", label: "Balanced", hint: "Default KovaGPT", values: { ...DEFAULT_PERSONALITY } },
  { id: "friendly", label: "Friendly", hint: "Warm and casual", values: { ...DEFAULT_PERSONALITY, kindness: 9, friendliness: 9, humor: 7, formalness: 3, energy: 7, seriousness: 3 } },
  { id: "professional", label: "Professional", hint: "Formal and precise", values: { ...DEFAULT_PERSONALITY, formalness: 9, seriousness: 8, humor: 2, directness: 8, conciseness: 7, detail: 7 } },
  { id: "playful", label: "Playful", hint: "Witty and light", values: { ...DEFAULT_PERSONALITY, humor: 10, energy: 9, friendliness: 9, seriousness: 2, creativity: 9, formalness: 2 } },
  { id: "concise", label: "Concise", hint: "Short and direct", values: { ...DEFAULT_PERSONALITY, conciseness: 10, directness: 10, detail: 2, humor: 3 } },
  { id: "mentor", label: "Mentor", hint: "Thorough and patient", values: { ...DEFAULT_PERSONALITY, detail: 10, kindness: 8, creativity: 7, directness: 6, seriousness: 6, friendliness: 8 } },
];

export function loadPersonality(): Personality {
  if (typeof window === "undefined") return DEFAULT_PERSONALITY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PERSONALITY;
    return { ...DEFAULT_PERSONALITY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PERSONALITY;
  }
}

export function loadAutoAdapt(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function personalityToInstruction(p: Personality): string {
  const notable = TRAITS.filter((t) => (p[t.key] ?? 5) !== 5).map((t) => {
    const v = p[t.key];
    return `${t.label.toLowerCase()}=${v}/10`;
  });
  const auto = loadAutoAdapt()
    ? "Auto-adapt: continuously observe how the user writes (length, formality, humor, detail preference) and mirror their style. When they give feedback like 'shorter', 'more casual', 'more detail', apply it for the rest of the conversation."
    : "";
  const traits = notable.length
    ? `Response tone (1=low, 10=high): ${notable.join(", ")}. Blend naturally; do not mention these settings.`
    : "";
  return [traits, auto].filter(Boolean).join(" ");
}

export function PersonalitySliders() {
  const { tier } = useTier();
  const unlocked = tierRank(tier) >= tierRank("plus");
  const [values, setValues] = useState<Personality>(DEFAULT_PERSONALITY);
  const [autoAdapt, setAutoAdapt] = useState<boolean>(true);

  useEffect(() => {
    setValues(loadPersonality());
    setAutoAdapt(loadAutoAdapt());
  }, []);

  function update(key: TraitKey, v: number) {
    if (!unlocked) return;
    const next = { ...values, [key]: v };
    setValues(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function applyPreset(preset: Personality) {
    if (!unlocked) return;
    setValues(preset);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
    } catch {
      /* ignore */
    }
  }

  function toggleAuto() {
    const next = !autoAdapt;
    setAutoAdapt(next);
    try {
      localStorage.setItem(AUTO_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function reset() {
    if (!unlocked) return;
    setValues(DEFAULT_PERSONALITY);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PERSONALITY));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Personality
        </h3>
        {unlocked && (
          <button
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Reset
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Pick a preset or fine-tune 10 traits. Kova also adapts to how you write when Auto-adapt is on.
      </p>

      <div className={`mb-4 ${unlocked ? "" : "pointer-events-none opacity-70"}`}>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PERSONALITY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.values)}
              className="text-xs px-2.5 py-1 rounded-full border border-border bg-background/60 hover:bg-accent transition"
              title={preset.hint}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoAdapt}
            onChange={toggleAuto}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span>
            <span className="font-medium text-foreground">Auto-adapt to me.</span> Kova learns your style
            (length, formality, humor) and mirrors it. Say "shorter", "more casual", or "add detail" and it adjusts.
          </span>
        </label>
      </div>



      <div
        className={`grid gap-4 sm:grid-cols-2 ${unlocked ? "" : "pointer-events-none blur-[2px] opacity-70 select-none"}`}
      >
        {TRAITS.map((t) => (
          <div key={t.key} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium text-foreground">{t.label}</div>
                <div className="text-muted-foreground">{t.hint}</div>
              </div>
              <span className="tabular-nums text-muted-foreground w-8 text-right">
                {values[t.key]}
              </span>
            </div>
            <Slider
              value={[values[t.key]]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => update(t.key, v[0] ?? 5)}
            />
          </div>
        ))}
      </div>

      {!unlocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-sm">
          <div className="text-center max-w-xs p-4">
            <Lock className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm font-medium mb-1">Included with Plus & Pro</div>
            <p className="text-xs text-muted-foreground mb-3">
              Customize KovaGPT's tone across 10 traits. Available on paid plans.
            </p>
            <Link
              to="/pricing"
              className="inline-block text-xs font-medium px-3 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition"
            >
              Upgrade to Plus
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
