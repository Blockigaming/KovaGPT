/**
 * KovaGPT logo: refined compass star inside a thin ring with inner cross detail.
 * Pure SVG so it stays sharp at any size and adds zero network/image cost.
 * Uses currentColor so it inverts cleanly between light and dark surfaces.
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
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.85"
      />
      <path
        d="M24 13L26.5 21.5L35 24L26.5 26.5L24 35L21.5 26.5L13 24L21.5 21.5L24 13Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M24 18V30M18 24H30"
        stroke="var(--color-background, #ffffff)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
