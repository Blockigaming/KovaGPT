// Small live analog clock. Renders once and ticks via requestAnimationFrame-lite setInterval.
import { useEffect, useState } from "react";

export function ClockWidget({ size = 72 }: { size?: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  const secDeg = s * 6;
  const minDeg = m * 6;
  const hourDeg = h * 30;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="#111" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {[...Array(12)].map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = cx + Math.sin(angle) * (r - 4);
        const y1 = cy - Math.cos(angle) * (r - 4);
        const x2 = cx + Math.sin(angle) * (r - 1);
        const y2 = cy - Math.cos(angle) * (r - 1);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={i % 3 === 0 ? 1.5 : 0.75} strokeLinecap="round" />;
      })}
      <g transform={`rotate(${hourDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.5} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g transform={`rotate(${minDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.75} stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
      </g>
      <g transform={`rotate(${secDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy + 6} x2={cx} y2={cy - r * 0.85} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r={2} fill="#3b82f6" />
    </svg>
  );
}
