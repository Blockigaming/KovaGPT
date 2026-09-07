import { Link } from "@tanstack/react-router";

type WorkspaceMode = "chat" | "work";

function modeClass(active: boolean) {
  return `inline-flex min-h-10 min-w-16 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
  }`;
}

export function WorkspaceModeSwitch({
  active,
  className = "",
}: {
  active: WorkspaceMode;
  className?: string;
}) {
  return (
    <nav
      aria-label="Primary workspace"
      className={`items-center rounded-full border border-border/70 bg-muted/70 p-1 shadow-sm backdrop-blur ${className}`}
    >
      <Link
        to="/"
        preload="intent"
        aria-current={active === "chat" ? "page" : undefined}
        className={modeClass(active === "chat")}
      >
        Chat
      </Link>
      <Link
        to="/work"
        preload="intent"
        aria-current={active === "work" ? "page" : undefined}
        className={modeClass(active === "work")}
      >
        Work
      </Link>
    </nav>
  );
}
