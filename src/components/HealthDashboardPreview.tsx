import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const metrics = [
  { label: "Sleep", value: 82, color: "#8b5cf6" },
  { label: "Recovery", value: 74, color: "#06b6d4" },
  { label: "Activity", value: 91, color: "#f59e0b" },
];
export function HealthDashboardPreview() {
  return (
    <section aria-label="Fictional health dashboard example" className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Health overview</h3><p className="mt-1 text-xs text-muted-foreground">Example sleep, recovery and activity scores</p></div>
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">COMING SOON · DEMO DATA</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-border bg-muted/20 p-3 text-center">
            <div className="relative mx-auto h-36 w-36" role="img" aria-label={`Fictional ${metric.label} score ${metric.value} out of 100`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={[{ value: metric.value }, { value: 100 - metric.value }]} dataKey="value" innerRadius={49} outerRadius={61} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                  <Cell fill={metric.color}/><Cell fill="#9ca3af" fillOpacity={0.18}/>
                </Pie></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold tabular-nums">{metric.value}</span><span className="text-xs text-muted-foreground">/ 100</span></div>
            </div>
            <p className="mt-1 text-sm font-medium">{metric.label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Illustrative values only, not medical measurements or a diagnosis. No provider account is connected to this example.</p>
    </section>
  );
}
