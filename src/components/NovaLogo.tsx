import logo from "@/assets/nova-logo.png";

export function NovaLogo({
  className = "w-6 h-6",
  bare = false,
}: {
  className?: string;
  /** Render without the white circle background (rare — usually leave default) */
  bare?: boolean;
}) {
  if (bare) {
    return (
      <img
        src={logo}
        alt="NovaGPT Logo"
        className={className}
        width={512}
        height={512}
        loading="lazy"
        style={{ objectFit: "contain" }}
      />
    );
  }
  return (
    <span
      className={`${className} relative inline-flex items-center justify-center rounded-full bg-white`}
    >
      <img
        src={logo}
        alt="NovaGPT Logo"
        className="absolute inset-0 w-full h-full rounded-full"
        width={512}
        height={512}
        loading="lazy"
        style={{ objectFit: "cover", display: "block" }}
      />
    </span>
  );
}
