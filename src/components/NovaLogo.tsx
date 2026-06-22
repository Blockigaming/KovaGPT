import logo from "@/assets/nova-logo.png";

export function NovaLogo({
  className = "w-6 h-6",
}: {
  className?: string;
  /** @deprecated kept for backwards compat */
  bare?: boolean;
}) {
  return (
    <img
      src={logo}
      alt="NovaGPT logo"
      className={`${className} object-contain dark:invert`}
      width={1024}
      height={1024}
      loading="lazy"
    />
  );
}
