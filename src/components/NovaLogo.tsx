/**
 * KovaGPT logo: refined compass star inside a thin ring with inner cross detail.
 * Pure SVG so it stays sharp at any size and adds zero network/image cost.
 */
export function NovaLogo({
  className = "w-6 h-6",
}: {
  className?: string;
  /** @deprecated kept for backwards compat */
  bare?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-label="KovaGPT logo"
      role="img"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sophisticated thin ring */}
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="white"
        strokeWidth="1.5"
        strokeOpacity="0.9"
      />
      {/* Refined compass star */}
      <path
        d="M24 10.5L27 21L37.5 24L27 27L24 37.5L21 27L10.5 24L21 21L24 10.5Z"
        fill="white"
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Inner detail cross */}
      <path
        d="M24 17V31M17 24H31"
        stroke="#0a0a0a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
