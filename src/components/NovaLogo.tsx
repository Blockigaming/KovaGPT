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
        alt="NovaGPT"
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
      className={`${className} inline-flex items-center justify-center rounded-full bg-white overflow-hidden`}
    >
      <img
        src={logo}
        alt="NovaGPT"
        className="w-[94%] h-[94%]"
        width={512}
        height={512}
        loading="lazy"
        style={{ objectFit: "contain", display: "block" }}
      />
    </span>
  );
}
