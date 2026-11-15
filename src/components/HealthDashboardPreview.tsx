const metrics = [
  { label: "Sleep", value: 82, color: "#8b5cf6" },
  { label: "Recovery", value: 74, color: "#06b6d4" },
  { label: "Activity", value: 91, color: "#f59e0b" },
];
export function HealthDashboardPreview() {
  return (
    <section aria-label="Fictional health dashboard example" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="font-semibold">Health overview</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Example sleep, recovery and activity scores
          </p>
        </div>
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
          Sample data
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-3xl bg-muted/30 p-3 text-center">
            <div
              className="relative mx-auto h-36 w-36"
              role="img"
              aria-label={`Fictional ${metric.label} score ${metric.value} out of 100`}
            >
              <svg viewBox="0 0 144 144" className="size-full" aria-hidden="true">
                <circle
                  cx="72"
                  cy="72"
                  r="55"
                  fill="none"
                  stroke="#9ca3af"
                  strokeOpacity={0.18}
                  strokeWidth="12"
                />
                <circle
                  cx="72"
                  cy="72"
                  r="55"
                  pathLength="100"
                  fill="none"
                  stroke={metric.color}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${metric.value} 100`}
                  transform="rotate(-90 72 72)"
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tabular-nums">{metric.value}</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
            </div>
            <p className="mt-1 text-sm font-medium">{metric.label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Connect a health account and read its summaries to see your own data.
      </p>
    </section>
  );
}
