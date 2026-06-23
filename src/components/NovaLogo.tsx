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
        d="M24 8L27.5 20.5L40 24L27.5 27.5L24 40L20.5 27.5L8 24L20.5 20.5L24 8Z"
        fill="white"
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Inner detail cross */}
      <path
        d="M24 16V32M16 24H32"
        stroke="#0a0a0a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
