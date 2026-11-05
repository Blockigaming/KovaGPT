import { Button } from "@/components/ui/button";
import { useEffect, useId, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Sparkles } from "lucide-react";
import { useTier, type Tier } from "@/hooks/useTier";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

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

const STORAGE_KEY_BASE = "kova-personality";
const AUTO_KEY_BASE = "kova-personality-auto-adapt";
export const DEFAULT_PERSONALITY: Personality = TRAITS.reduce(
  (acc, t) => ({ ...acc, [t.key]: 5 }),
  {} as Personality,
);

export const PERSONALITY_PRESETS: {
  id: string;
  label: string;
  hint: string;
  values: Personality;
}[] = [
  {
    id: "balanced",
    label: "Balanced",
    hint: "Default KovaGPT",
    values: { ...DEFAULT_PERSONALITY },
  },
  {
    id: "friendly",
    label: "Friendly",
    hint: "Warm and casual",
    values: {
      ...DEFAULT_PERSONALITY,
      kindness: 9,
      friendliness: 9,
      humor: 7,
      formalness: 3,
      energy: 7,
      seriousness: 3,
    },
  },
  {
    id: "professional",
    label: "Professional",
    hint: "Formal and precise",
    values: {
      ...DEFAULT_PERSONALITY,
      formalness: 9,
      seriousness: 8,
      humor: 2,
      directness: 8,
      conciseness: 7,
      detail: 7,
    },
  },
  {
    id: "playful",
    label: "Playful",
    hint: "Witty and light",
    values: {
      ...DEFAULT_PERSONALITY,
      humor: 10,
      energy: 9,
      friendliness: 9,
      seriousness: 2,
      creativity: 9,
      formalness: 2,
    },
  },
  {
    id: "concise",
    label: "Concise",
    hint: "Short and direct",
    values: { ...DEFAULT_PERSONALITY, conciseness: 10, directness: 10, detail: 2, humor: 3 },
  },
  {
    id: "mentor",
    label: "Mentor",
    hint: "Thorough and patient",
    values: {
      ...DEFAULT_PERSONALITY,
      detail: 10,
      kindness: 8,
      creativity: 7,
      directness: 6,
      seriousness: 6,
      friendliness: 8,
    },
  },
];

export function loadPersonality(userKey: string | null | undefined = undefined): Personality {
  const key = principalScopedStorageKey(STORAGE_KEY_BASE, userKey);
  if (!key) return DEFAULT_PERSONALITY;
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(key);
    if (!raw) return DEFAULT_PERSONALITY;
    return { ...DEFAULT_PERSONALITY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PERSONALITY;
  }
}

export function loadAutoAdapt(userKey: string | null | undefined = undefined): boolean {
  const key = principalScopedStorageKey(AUTO_KEY_BASE, userKey);
  if (!key) return true;
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(key);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function personalityToInstruction(
  p: Personality,
  userKey: string | null | undefined = undefined,
  tier: Tier = "pro",
): string {
  const preset =
    tier === "free"
      ? PERSONALITY_PRESETS.slice(0, 3).find(({ values }) =>
          TRAITS.every(({ key }) => p[key] === values[key]),
        )
      : null;
  const traitsToUse = tier === "pro" || preset ? TRAITS : tier === "plus" ? TRAITS.slice(0, 5) : [];
  const notable = traitsToUse
    .filter((t) => (p[t.key] ?? 5) !== 5)
    .map((t) => {
      const v = p[t.key];
      return `${t.label.toLowerCase()}=${v}/10`;
    });
  const auto =
    tier === "pro" && loadAutoAdapt(userKey)
      ? "Auto-adapt: continuously observe how the user writes (length, formality, humor, detail preference) and mirror their style. When they give feedback like 'shorter', 'more casual', 'more detail', apply it for the rest of the conversation."
      : "";
  const traits = notable.length
    ? `Response tone (1=low, 10=high): ${notable.join(", ")}. Blend naturally; do not mention these settings.`
    : "";
  return [traits, auto].filter(Boolean).join(" ");
}

export function PersonalitySliders({
  userKey,
  principalResolved,
}: {
  userKey: string | null;
  principalResolved: boolean;
}) {
  const sliderId = useId();
  const { tier } = useTier();
  const traits = tier === "pro" ? TRAITS : tier === "plus" ? TRAITS.slice(0, 5) : [];
  const presets = tier === "free" ? PERSONALITY_PRESETS.slice(0, 3) : PERSONALITY_PRESETS;
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const storageKey = principalResolved
    ? principalScopedStorageKey(STORAGE_KEY_BASE, userKey)
    : null;
  const autoKey = principalResolved ? principalScopedStorageKey(AUTO_KEY_BASE, userKey) : null;
  const generationRef = useRef(0);
  const [loadedPrincipal, setLoadedPrincipal] = useState<string | null>(null);
  const [values, setValues] = useState<Personality>(DEFAULT_PERSONALITY);
  const [autoAdapt, setAutoAdapt] = useState<boolean>(true);
  const ready = principal !== null && loadedPrincipal === principal;
  const visibleValues = ready ? values : DEFAULT_PERSONALITY;
  const visibleAutoAdapt = ready ? autoAdapt : true;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!principalResolved || !principal) {
      setLoadedPrincipal(null);
      setValues(DEFAULT_PERSONALITY);
      setAutoAdapt(true);
      return;
    }
    const nextValues = loadPersonality(userKey);
    const nextAuto = loadAutoAdapt(userKey);
    if (generationRef.current !== generation) return;
    setValues(nextValues);
    setAutoAdapt(nextAuto);
    setLoadedPrincipal(principal);
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      generationRef.current += 1;
      setValues(DEFAULT_PERSONALITY);
      setAutoAdapt(true);
      setLoadedPrincipal(principal);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [principal, principalResolved, userKey]);

  function update(key: TraitKey, v: number) {
    if (!ready || !storageKey) return;
    const next = { ...values, [key]: v };
    setValues(next);
    try {
      safeBrowserStorage("localStorage")?.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function applyPreset(preset: Personality) {
    if (!ready || !storageKey) return;
    setValues(preset);
    try {
      safeBrowserStorage("localStorage")?.setItem(storageKey, JSON.stringify(preset));
    } catch {
      /* ignore */
    }
  }

  function toggleAuto() {
    if (!ready || !autoKey) return;
    const next = !autoAdapt;
    setAutoAdapt(next);
    try {
      safeBrowserStorage("localStorage")?.setItem(autoKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function reset() {
    if (!ready || !storageKey) return;
    setValues(DEFAULT_PERSONALITY);
    try {
      safeBrowserStorage("localStorage")?.setItem(storageKey, JSON.stringify(DEFAULT_PERSONALITY));
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
        <Button
          data-ui-reference="chatgpt.customization-preferences.control"
          variant="ghost"
          onClick={reset}
          disabled={!ready}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          Reset
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {tier === "free"
          ? "Choose a preset for how Kova responds."
          : tier === "plus"
            ? "Choose a preset and fine-tune five response traits."
            : "Choose a preset, fine-tune ten response traits, or let Kova adapt to your style."}
      </p>

      <div className={traits.length ? "mb-4" : undefined}>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {presets.map((preset) => (
            <Button
              data-ui-reference="chatgpt.customization-preferences.control"
              variant="outline"
              key={preset.id}
              onClick={() => applyPreset(preset.values)}
              disabled={!ready}
              aria-pressed={TRAITS.every(({ key }) => visibleValues[key] === preset.values[key])}
              className="text-xs px-2.5   border border-border bg-background/60 hover:bg-accent transition"
              title={preset.hint}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        {tier === "pro" && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground cursor-pointer select-none">
            <Switch
              aria-label="Auto-adapt to me"
              checked={visibleAutoAdapt}
              disabled={!ready}
              onCheckedChange={toggleAuto}
            />
            <span>
              <span className="font-medium text-foreground">Auto-adapt to me.</span> Kova learns
              your style (length, formality, humor) and mirrors it. Say "shorter", "more casual", or
              "add detail" and it adjusts.
            </span>
          </label>
        )}
      </div>

      {traits.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {traits.map((t) => (
            <div key={t.key} className="min-w-0 space-y-1.5 px-1">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div id={`${sliderId}-${t.key}-label`} className="font-medium text-foreground">
                    {t.label}
                  </div>
                  <div id={`${sliderId}-${t.key}-hint`} className="text-muted-foreground">
                    {t.hint}
                  </div>
                </div>
                <span className="tabular-nums text-muted-foreground w-8 text-right">
                  {visibleValues[t.key]}
                </span>
              </div>
              <Slider
                data-ui-reference="chatgpt.customization-preferences.slider"
                thumbProps={{
                  "aria-labelledby": `${sliderId}-${t.key}-label`,
                  "aria-describedby": `${sliderId}-${t.key}-hint`,
                  "aria-valuetext": `${visibleValues[t.key]} out of 10`,
                }}
                value={[visibleValues[t.key]]}
                disabled={!ready}
                min={1}
                max={10}
                step={1}
                onValueChange={(v) => update(t.key, v[0] ?? 5)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
