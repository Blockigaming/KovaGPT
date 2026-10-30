import { Link } from "@tanstack/react-router";

type WorkspaceMode = "chat" | "work";

function modeClass(active: boolean) {
  return `kova-workspace-mode ${active ? "is-active" : ""}`;
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
      data-ui-reference="chatgpt.work-mode-switch"
      className={`kova-workspace-mode-switch flex ${className}`}
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
