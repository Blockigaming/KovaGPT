/**
 * The shared KovaGPT brand mark.
 *
 * Keep every in-app logo routed through this component so the product uses the
 * same source image in navigation, authentication, checkout, and landing pages.
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
    <img
      src="/kova-logo.png?v=20260807"
      className={`${className} block shrink-0 object-contain ${animated ? "animate-kova-float" : ""}`}
      data-logo-variant={mark ? "mark" : "standard"}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
    />
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
