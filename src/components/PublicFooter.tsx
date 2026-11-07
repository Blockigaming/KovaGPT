import { Link } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
const links = [
  { label: "Help", to: "/help" },
  { label: "Support", to: "/contact-support" },
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "Refunds", to: "/refund" },
] as const;
export function PublicFooter() {
  return <footer className="border-t border-border px-5 py-6 text-sm text-muted-foreground">
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3">
      <Link to="/" aria-label="KovaGPT home" className="inline-flex items-center gap-2">
        <NovaLogo decorative mark className="h-5 w-5" />
        KovaGPT
      </Link>
      <nav aria-label="Support and policies" className="flex flex-wrap gap-4">
        {links.map((link) => <Link key={link.to} to={link.to}>{link.label}</Link>)}
      </nav>
      <span className="ml-auto">© {new Date().getFullYear()} KovaGPT</span>
    </div>
  </footer>;
}
