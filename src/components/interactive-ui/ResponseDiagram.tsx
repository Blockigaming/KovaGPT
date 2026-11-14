import { useId } from "react";
import type { DiagramBlock } from "@/lib/interactive-ui.mjs";

export function ResponseDiagram({ block }: { block: DiagramBlock }) {
  const id = useId();
  const nodes = block.nodes.map((node) => ({
    ...node,
    cx: 90 + node.x * 6,
    cy: 42 + node.y * 3.6,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <figure className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <figcaption id={id} className="font-semibold">
        {block.title}
      </figcaption>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      <div
        className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-2"
        role="region"
        aria-label="Scrollable diagram"
        tabIndex={0}
      >
        <svg
          className="block h-auto w-full min-w-[38rem]"
          viewBox="0 0 780 444"
          role="img"
          aria-labelledby={id}
        >
          <defs>
            <marker
              id={`${id}-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0L10 5L0 10Z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          {block.edges.map((edge) => {
            const from = byId.get(edge.from)!;
            const to = byId.get(edge.to)!;
            const dx = to.cx - from.cx;
            const dy = to.cy - from.cy;
            const boxOffset = Math.min(1, Math.max(Math.abs(dx) / 82, Math.abs(dy) / 26) ** -1);
            const decisionOffset = Math.min(1, (Math.abs(dx) / 86 + Math.abs(dy) / 32) ** -1);
            const start = from.shape === "decision" ? decisionOffset : boxOffset;
            const end = to.shape === "decision" ? decisionOffset : boxOffset;
            const visible = start + end < 1;
            return (
              <g key={`${edge.from}:${edge.to}`}>
                {visible && (
                  <line
                    x1={from.cx + dx * start}
                    y1={from.cy + dy * start}
                    x2={to.cx - dx * end}
                    y2={to.cy - dy * end}
                    stroke="var(--muted-foreground)"
                    strokeWidth="1.5"
                    markerEnd={`url(#${id}-arrow)`}
                  />
                )}
                {visible && edge.label && (
                  <text
                    x={(from.cx + to.cx) / 2}
                    y={(from.cy + to.cy) / 2 - 5}
                    fill="var(--foreground)"
                    stroke="var(--card)"
                    strokeWidth="4"
                    paintOrder="stroke"
                    textAnchor="middle"
                    fontSize="13"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map(({ id: nodeId, cx, cy, label, shape }) => (
            <g key={nodeId} transform={`translate(${cx} ${cy})`}>
              {shape === "decision" ? (
                <path
                  d="M0 -32L86 0L0 32L-86 0Z"
                  fill="var(--muted)"
                  stroke="var(--muted-foreground)"
                />
              ) : (
                <rect
                  x="-82"
                  y="-26"
                  width="164"
                  height="52"
                  rx={shape === "terminal" ? 26 : 10}
                  fill="var(--muted)"
                  stroke="var(--muted-foreground)"
                />
              )}
              <text
                x="0"
                y="0"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="12"
                fill="var(--foreground)"
              >
                {label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Diagram text
        </summary>
        <ul className="list-disc pl-5">
          {nodes.map((node) => (
            <li key={node.id}>{node.label}</li>
          ))}
          {block.edges.map(({ from, to, label }) => (
            <li key={`${from}:${to}`}>
              {byId.get(from)?.label} → {byId.get(to)?.label}
              {label && ` (${label})`}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
