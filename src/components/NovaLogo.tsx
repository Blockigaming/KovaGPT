import logo from "@/assets/nova-logo.png";

export function NovaLogo({ className = "w-6 h-6" }: { className?: string }) {
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
