import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import land from "@/assets/response-world-land.svg";
import type { ResponseMapBlock } from "@/lib/interactive-ui.mjs";

function project(place: ResponseMapBlock["places"][number]) {
  return { x: (place.longitude + 180) * 2, y: (90 - place.latitude) * 2 };
}

export function ResponseMap({ block }: { block: ResponseMapBlock }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 360, y: 180 });
  const width = 720 / zoom;
  const height = 360 / zoom;
  const clamp = (value: number, extent: number, window: number) =>
    Math.max(window / 2, Math.min(extent - window / 2, value));
  const select = (index: number) => {
    setActive(index);
    setPan(project(block.places[index]));
  };
  const current = block.places[active];
  const points = block.places.map(project);
  const clamped = { x: clamp(pan.x, 720, width), y: clamp(pan.y, 360, height) };
  return (
    <section
      aria-labelledby={id}
      className="my-3 grid min-w-0 gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <h3 id={id} className="font-semibold">
        {block.title}
      </h3>
      {block.description && <p className="text-sm text-muted-foreground">{block.description}</p>}
      <svg
        role="img"
        aria-label="World map showing the listed locations"
        viewBox={`${clamped.x - width / 2} ${clamped.y - height / 2} ${width} ${height}`}
        className="w-full rounded-xl border border-border bg-muted"
      >
        <image href={land} width={720} height={360} />
        {block.connect &&
          points.slice(1).map(({ x, y }, index) => {
            const previous = points[index];
            // Draw across the short side of the date line when appropriate.
            const displacement = x - previous.x;
            const offset = Math.abs(displacement) > 360 ? -720 * Math.sign(displacement) : 0;
            return (offset ? [0, -offset] : [0]).map((shift) => (
              <line
                key={`${index}-${shift}`}
                x1={previous.x + shift}
                y1={previous.y}
                x2={x + offset + shift}
                y2={y}
                stroke="var(--primary)"
                strokeWidth={2 / zoom}
              />
            ));
          })}
        {points.map(({ x, y }, index) => (
          <circle
            key={block.places[index].id}
            cx={x}
            cy={y}
            r={(index === active ? 8 : 5) / zoom}
            fill="var(--primary)"
            stroke="var(--primary-foreground)"
            strokeWidth={2 / zoom}
          >
            <title>{block.places[index].label}</title>
          </circle>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Map view">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={zoom === 1}
          onClick={() => setZoom(zoom / 2)}
        >
          Zoom out
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={zoom === 8}
          onClick={() => setZoom(zoom * 2)}
        >
          Zoom in
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            setZoom(1);
            setPan({ x: 360, y: 180 });
          }}
        >
          World view
        </Button>
      </div>
      {zoom > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pan map">
          {(
            [
              ["west", -1, 0],
              ["east", 1, 0],
              ["north", 0, -1],
              ["south", 0, 1],
            ] as const
          ).map(([label, x, y]) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() =>
                setPan({
                  x: clamp(clamped.x + (x * width) / 4, 720, width),
                  y: clamp(clamped.y + (y * height) / 4, 360, height),
                })
              }
            >
              Pan {label}
            </Button>
          ))}
        </div>
      )}
      <label className="grid gap-1 text-sm">
        Location
        <select
          value={active}
          className="min-h-11 min-w-0 rounded-lg border border-border bg-background px-2"
          onChange={(event) => select(Number(event.currentTarget.value))}
        >
          {block.places.map((place, index) => (
            <option key={place.id} value={index}>
              {place.label}
            </option>
          ))}
        </select>
      </label>
      <div aria-live="polite" className="grid gap-1 text-sm">
        <p className="font-medium">{current.label}</p>
        <p className="text-muted-foreground">
          {current.latitude}°, {current.longitude}°
        </p>
        {current.detail && <p>{current.detail}</p>}
      </div>
      {block.connect && (
        <p className="text-xs text-muted-foreground">Lines connect locations in order.</p>
      )}
    </section>
  );
}
