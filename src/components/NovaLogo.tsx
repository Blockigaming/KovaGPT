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
  const logo = mark ? (
    <svg
      viewBox="150 180 584 496"
      role="img"
      aria-label="KovaGPT logo"
      className={`${className} block shrink-0 ${animated ? "animate-kova-float" : ""}`}
      fill="none"
    >
      <g fill="none" stroke="currentColor" strokeWidth={20} strokeLinecap="round">
        <path d="M228 552A246 246 0 0 1 642 300" />
        <path d="M658 329A246 246 0 0 1 249 584" />
      </g>
      <path
        d="M442 226C459 321 470 368 504 393C529 411 574 421 642 438C575 455 530 466 504 484C471 509 459 556 441 650C423 556 411 509 378 484C353 466 309 455 243 438C309 421 353 410 378 392C411 367 423 320 442 226Z"
        fill="currentColor"
      />
    </svg>
  ) : (
    <img
      src="/kova-logo.png"
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
