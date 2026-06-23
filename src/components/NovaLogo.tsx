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
        stroke="#e6e6e6"
        strokeWidth="1.5"
        strokeOpacity="0.9"
      />
      {/* Refined compass star — softer white, more breathing room */}
      <path
        d="M24 13L26.5 21.5L35 24L26.5 26.5L24 35L21.5 26.5L13 24L21.5 21.5L24 13Z"
        fill="#e6e6e6"
        stroke="#e6e6e6"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Inner detail cross */}
      <path
        d="M24 18V30M18 24H30"
        stroke="#0a0a0a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
