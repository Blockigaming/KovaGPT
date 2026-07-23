/**
 * KovaGPT logo: refined compass star inside a thin ring with inner cross detail.
 * Pure SVG so it stays sharp at any size and adds zero network/image cost.
 *
 * animated: applies a gentle vertical float (used in the sidebar brand row
 *           and the empty-state hero).
 * pulse:    wraps in a soft brand halo that pulses (used on the assistant
 *           avatar while a response is streaming).
 */
export function NovaLogo({
  className = "w-6 h-6",
  animated = false,
  pulse = false,
}: {
  className?: string;
  animated?: boolean;
  pulse?: boolean;
  /** @deprecated kept for backwards compat */
  bare?: boolean;
}) {
  const svg = (
    <svg
      viewBox="0 0 48 48"
      className={`${className} ${animated ? "animate-kova-float" : ""}`}
      aria-label="KovaGPT logo"
      role="img"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="21" fill="white" />
      <circle cx="24" cy="24" r="22" stroke="black" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="21" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
      <path
        d="M24 13L26.5 21.5L35 24L26.5 26.5L24 35L21.5 26.5L13 24L21.5 21.5L24 13Z"
        fill="black"
        stroke="black"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M24 18V30M18 24H30" stroke="white" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );

  if (pulse) {
    return (
      <span className="relative inline-flex">
        <span aria-hidden="true" className="absolute inset-0 rounded-full animate-kova-pulse" />
        {svg}
      </span>
    );
  }
  return svg;
}
