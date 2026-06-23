/**
 * NovaGPT logo: a white compass star inside a white ring.
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
      viewBox="0 0 64 64"
      className={className}
      aria-label="NovaGPT logo"
      role="img"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer white ring */}
      <circle cx="32" cy="32" r="29" stroke="white" strokeWidth="3" />
      {/* Compass star: 4 long points + 4 short points */}
      <path
        d="M32 8 L36 28 L56 32 L36 36 L32 56 L28 36 L8 32 L28 28 Z"
        fill="white"
      />
      <path
        d="M32 18 L34 30 L46 32 L34 34 L32 46 L30 34 L18 32 L30 30 Z"
        fill="#0a0a0a"
        opacity="0.85"
      />
    </svg>
  );
}
