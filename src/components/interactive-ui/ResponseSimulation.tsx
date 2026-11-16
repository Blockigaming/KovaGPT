import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SimulationBlock, SimulationModel } from "@/lib/interactive-ui.mjs";

const models: Record<
  SimulationModel,
  { formula: string; result: string; compute: (values: Record<string, number>) => number }
> = {
  linear: {
    formula: "y = mx + b",
    result: "y",
    compute: ({ slope, intercept, x }) => slope * x + intercept,
  },
  quadratic: {
    formula: "y = ax² + bx + c",
    result: "y",
    compute: ({ a, b, c, x }) => a * x ** 2 + b * x + c,
  },
  rectangle: {
    formula: "Area = width × height",
    result: "Area",
    compute: ({ width, height }) => width * height,
  },
  "constant-acceleration": {
    formula: "Displacement = v₀t + ½at²",
    result: "Displacement (m)",
    compute: ({ initialVelocity, acceleration, seconds }) =>
      initialVelocity * seconds + 0.5 * acceleration * seconds ** 2,
  },
  "independent-events": {
    formula: "P(at least one) = 1 − (1 − p)ⁿ",
    result: "Chance (%)",
    compute: ({ probability, trials }) => (1 - (1 - probability / 100) ** trials) * 100,
  },
  molarity: {
    formula: "Molarity = moles ÷ liters",
    result: "Concentration (mol/L)",
    compute: ({ moles, liters }) => moles / liters,
  },
  "compound-interest": {
    formula: "Balance = principal × (1 + rate ÷ 100)ʸᵉᵃʳˢ",
    result: "Balance",
    compute: ({ principal, rate, years }) => principal * (1 + rate / 100) ** years,
  },
};
const labels: Record<string, string> = {
  slope: "Slope (m)",
  intercept: "Intercept (b)",
  x: "x",
  a: "a",
  b: "b",
  c: "c",
  width: "Width",
  height: "Height",
  principal: "Starting principal",
  rate: "Annual rate (%)",
  years: "Years",
  initialVelocity: "Initial velocity (m/s)",
  acceleration: "Acceleration (m/s²)",
  seconds: "Time (seconds)",
  probability: "Chance per trial (%)",
  trials: "Number of trials",
  moles: "Moles of solute",
  liters: "Liters of solution",
};
const numberFormat = new Intl.NumberFormat("en", { maximumSignificantDigits: 10 });

export function ResponseSimulation({ block }: { block: SimulationBlock }) {
  const id = useId();
  const initial = Object.fromEntries(
    Object.entries(block.inputs).map(([key, range]) => [key, range.value]),
  );
  const [values, setValues] = useState(initial);
  const model = models[block.model];
  const graphKey = (
    {
      linear: "x",
      quadratic: "x",
      "compound-interest": "years",
      "constant-acceleration": "seconds",
      "independent-events": "trials",
      molarity: "liters",
      rectangle: "width",
    } as const
  )[block.model];
  const graphRange = block.model === "rectangle" ? undefined : block.inputs[graphKey];
  const series = graphRange
    ? Array.from({ length: 41 }, (_, i) =>
        model.compute({
          ...values,
          [graphKey]: (() => {
            const sample = graphRange.min + ((graphRange.max - graphRange.min) * i) / 40;
            return graphKey === "trials" || graphKey === "years" ? Math.round(sample) : sample;
          })(),
        }),
      )
    : [];
  const result = model.compute(values);
  const min = series.length ? Math.min(...series, result) : 0;
  const max = series.length ? Math.max(...series, result) : 0;
  const graphY = (value: number) => 88 - 76 * (max === min ? 0.5 : (value - min) / (max - min));
  const dimension = Math.max(values.width ?? 0, values.height ?? 0, 1);
  const width = (76 * (values.width ?? 0)) / dimension;
  const height = (76 * (values.height ?? 0)) / dimension;

  return (
    <section
      aria-labelledby={id}
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <h3 id={id} className="text-base font-semibold">
        {block.title}
      </h3>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      <p className="mt-3 text-sm">{model.formula}</p>
      {graphRange ? (
        <svg
          className="mt-3 h-32 w-full text-primary"
          viewBox="0 0 240 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Plot over ${labels[graphKey]} from ${graphRange.min} to ${graphRange.max}`}
        >
          <path d="M10 10V90H230" fill="none" stroke="var(--border)" />
          <polyline
            points={series.map((value, i) => `${10 + i * 5.5},${graphY(value)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={
              10 + (220 * (values[graphKey] - graphRange.min)) / (graphRange.max - graphRange.min)
            }
            cy={graphY(result)}
            r="3"
            fill="currentColor"
          />
        </svg>
      ) : (
        <svg
          className="mt-3 h-32 w-full text-primary"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`Rectangle, width ${values.width}, height ${values.height}`}
        >
          <rect
            x={(100 - width) / 2}
            y={(100 - height) / 2}
            width={width}
            height={height}
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
          />
        </svg>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {Object.entries(block.inputs).map(([key, range]) => (
          <label
            key={key}
            className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-3 text-sm"
          >
            <span>{labels[key]}</span>
            <span aria-hidden="true" className="tabular-nums">
              {numberFormat.format(values[key])}
            </span>
            <input
              type="range"
              className="col-span-2 min-h-11 w-full accent-primary"
              min={range.min}
              max={range.max}
              step={range.step}
              value={values[key]}
              onChange={(event) =>
                setValues({ ...values, [key]: event.currentTarget.valueAsNumber })
              }
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <output className="font-semibold tabular-nums">
          {model.result} = {numberFormat.format(result)}
        </output>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => setValues(initial)}
        >
          Reset
        </Button>
      </div>
    </section>
  );
}
