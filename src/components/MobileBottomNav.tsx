import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, LayoutGrid, Library as LibraryIcon, FolderKanban, Settings as SettingsIcon } from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";

/**
 * Native-feeling mobile bottom tab bar. Rendered only under md breakpoint.
 * The desktop shell has its own persistent sidebar — this bar deliberately
 * only appears on small screens to give mobile a distinct, thumb-reachable UX.
 */
export function MobileBottomNav({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isSignedIn, isLoaded } = useUser();
  const signedIn = isLoaded && !!isSignedIn;

  const tabs: Array<{
    label: string;
    to?: "/" | "/apps" | "/library" | "/projects";
    match: (p: string) => boolean;
    icon: typeof MessageCircle;
    action?: () => void;
  }> = [
    { label: "Chat", to: "/", match: (p) => p === "/", icon: MessageCircle },
    { label: "Apps", to: "/apps", match: (p) => p.startsWith("/apps"), icon: LayoutGrid },
    { label: "Library", to: "/library", match: (p) => p.startsWith("/library"), icon: LibraryIcon },
    ...(signedIn
      ? [{ label: "Projects", to: "/projects" as const, match: (p: string) => p.startsWith("/projects"), icon: FolderKanban }]
      : []),
    { label: "Settings", match: () => false, icon: SettingsIcon, action: onOpenSettings },
  ];


  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = t.match(pathname);
          const Icon = t.icon;
          const inner = (
            <span
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium tracking-tight transition ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className={`w-[22px] h-[22px] ${active ? "" : "opacity-80"}`} strokeWidth={active ? 2.4 : 2} />
              <span>{t.label}</span>
            </span>
          );
          return (
            <li key={t.label} className="min-w-0">
              {t.to ? (
                <Link to={t.to} className="block active:scale-[0.94] transition">{inner}</Link>
              ) : (
                <button
                  type="button"
                  onClick={t.action}
                  className="w-full active:scale-[0.94] transition"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
