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
}: {
  className?: string;
  animated?: boolean;
  pulse?: boolean;
  /** Render only the compass mark (no white tile) so it sits on any surface. */
  mark?: boolean;
  /** @deprecated kept for backwards compatibility */
  bare?: boolean;
}) {
  const logo = (
    <img
      src="/kova-logo.png?v=20260807"
      className={`${className} block shrink-0 object-contain ${animated ? "animate-kova-float" : ""}`}
      alt="KovaGPT logo"
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
