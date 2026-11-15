import { Link } from "@tanstack/react-router";
import { Folder, LibraryBig, MessageSquare, Plug } from "lucide-react";
import { requestDrawerNavigationFocus } from "@/lib/drawer-navigation-focus";

const destinations = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/projects", label: "Projects", icon: Folder },
  { to: "/library", label: "Library", icon: LibraryBig },
  { to: "/apps", label: "Connections", icon: Plug },
] as const;

export function PhoneNavigation({ pathname, inactive }: { pathname: string; inactive: boolean }) {
  return (
    <nav className="kova-phone-navigation" aria-label="Mobile workspace" inert={inactive}>
      {destinations.map(({ to, label, icon: Icon }) => {
        const current = pathname === to;
        const inSection = current || (to !== "/" && pathname.startsWith(`${to}/`));
        return (
          <Link
            key={to}
            to={to}
            data-current={inSection}
            aria-current={current ? "page" : undefined}
            onClick={(event) => {
              if (
                current ||
                event.defaultPrevented ||
                event.detail !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              requestDrawerNavigationFocus({
                destination: to,
                source: event.currentTarget.closest("nav"),
              });
            }}
          >
            <span className="kova-phone-navigation-icon" aria-hidden="true">
              <Icon size={19} strokeWidth={1.8} />
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
