/**
 * The shared KovaGPT brand mark.
 *
 * Keep every in-app logo routed through this component so the product uses the
 * same first-paint vector in navigation, authentication, checkout, and landing pages.
 * `animated` and `pulse` preserve the motion treatments used by those surfaces.
 */
export function NovaLogo({
  className = "w-6 h-6",
  animated = false,
  pulse = false,
  mark = false,
  decorative = false,
  alt = "KovaGPT",
}: {
  className?: string;
  animated?: boolean;
  pulse?: boolean;
  /** Render only the compass mark (no white tile) so it sits on any surface. */
  mark?: boolean;
  /** Use when adjacent visible text already names the KovaGPT brand. */
  decorative?: boolean;
  /** Accessible name when the logo is the only content naming the brand. */
  alt?: string;
  /** @deprecated kept for backwards compatibility */
  bare?: boolean;
}) {
  const logo = (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : alt}
      data-logo-variant={mark ? "mark" : "standard"}
      focusable="false"
      role={decorative ? undefined : "img"}
      viewBox="0 0 24 24"
      className={`${className} kova-logo ${mark ? "kova-logo-mark" : "kova-logo-tile"} block shrink-0 ${animated ? "animate-kova-float" : ""}`}
    >
      {!mark ? <circle cx="12" cy="12" r="11" fill="currentColor" /> : null}
      <g className={mark ? undefined : "kova-logo-ink"}>
        <path
          d="M9.1 4.55A8 8 0 0 0 4 12a8 8 0 0 0 5.1 7.45"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
        <path
          d="M14.9 19.45A8 8 0 0 0 20 12a8 8 0 0 0-5.1-7.45"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
        <path
          fill="currentColor"
          d="m12 5.25 1.9 4.85 4.85 1.9-4.85 1.9-1.9 4.85-1.9-4.85L5.25 12l4.85-1.9L12 5.25Zm0 5.1L11.35 12l.65 1.65.65-1.65-.65-1.65Z"
          fillRule="evenodd"
        />
      </g>
    </svg>
  );

  if (pulse) {
    return (
      <span className="relative inline-flex">
        <span aria-hidden="true" className="absolute inset-0 rounded-full animate-kova-pulse" />
        {logo}
      </span>
    );
  }
  return logo;
}
