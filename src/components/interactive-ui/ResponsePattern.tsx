import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PatternBlock } from "@/lib/interactive-ui.mjs";

const patternLabels = {
  stripes: "Stripes",
  dots: "Dots",
  checks: "Checkerboard",
  gradient: "Gradient",
};

export function ResponsePattern({ block }: { block: PatternBlock }) {
  const id = useId();
  const [colors, setColors] = useState(block.colors);
  const [scale, setScale] = useState(24);
  const [first, second] = colors;
  const background = {
    stripes: `repeating-linear-gradient(45deg, ${first} 0 ${scale}px, ${second} ${scale}px ${scale * 2}px)`,
    dots: `radial-gradient(circle, ${first} 25%, ${second} 26%) 0 0 / ${scale}px ${scale}px`,
    checks: `repeating-conic-gradient(${first} 0% 25%, ${second} 0% 50%) 0 0 / ${scale * 2}px ${scale * 2}px`,
    gradient: `linear-gradient(135deg, ${first}, ${second})`,
  }[block.pattern];

  return (
    <figure className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <figcaption id={id} className="text-base font-semibold">
        {block.title}
      </figcaption>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      <div
        role="img"
        aria-label={`${patternLabels[block.pattern]} in ${first} and ${second}`}
        className="mt-3 h-40 rounded-xl border border-border"
        style={{ background }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {colors.map((color, index) => (
          <label key={index} className="flex items-center gap-2">
            Color {index + 1}
            <input
              className="h-11 w-12 cursor-pointer"
              type="color"
              value={color}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setColors(index === 0 ? [next, second] : [first, next]);
              }}
            />
          </label>
        ))}
        {block.pattern !== "gradient" && (
          <label className="flex min-w-0 items-center gap-2">
            Scale
            <input
              type="range"
              className="min-h-11 min-w-0 accent-primary"
              min={8}
              max={64}
              value={scale}
              onChange={(event) => setScale(event.currentTarget.valueAsNumber)}
            />
          </label>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setColors(block.colors);
            setScale(24);
          }}
        >
          Reset colors and scale
        </Button>
      </div>
    </figure>
  );
}
