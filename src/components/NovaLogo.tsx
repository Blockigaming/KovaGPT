/**
 * The shared KovaGPT brand mark.
 *
 * Keep every in-app logo routed through this component so the product uses the
 * same owner-supplied asset in navigation, authentication, checkout, and landing pages.
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
  /** Compatibility marker; every placement uses the approved owner asset. */
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
      src="/kova-logo.png"
      alt={decorative ? "" : alt}
      width={1024}
      height={1024}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : alt}
      data-logo-variant={mark ? "mark" : "standard"}
      className={`${className} kova-logo ${mark ? "kova-logo-mark" : "kova-logo-tile"} block shrink-0 rounded-full object-contain ${animated ? "animate-kova-float" : ""}`}
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
