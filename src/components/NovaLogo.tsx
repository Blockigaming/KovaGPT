/**
 * The shared KovaGPT brand mark.
 *
 * Keep every in-app logo routed through this component so the product uses the
 * same owner-supplied asset in navigation, authentication, checkout, and landing pages.
 * Placement owns sizing. Compatibility motion props no longer add glow or pulse.
 */
export function NovaLogo({
  className = "w-6 h-6",
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
  return (
    <img
      src="/kova-logo.png"
      alt={decorative ? "" : alt}
      width={24}
      height={24}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : alt}
      data-logo-variant={mark ? "mark" : "standard"}
      data-ui-reference="claude-brand-mark-placement"
      className={`${className} kova-logo ${mark ? "kova-logo-mark" : "kova-logo-tile"} block shrink-0 object-contain`}
    />
  );
}
