import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Folder, FolderPlus } from "lucide-react";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

export function ChatProjectSubmenu({
  ownerId,
  onSelect,
}: {
  ownerId: string;
  onSelect: (id: string) => void;
}) {
  const list = useServerFn(listProjects);
  const [state, setState] = useState<{
    owner: string;
    items: ProjectSummary[];
    error: boolean;
  } | null>(null);
  const current = useRef(ownerId);
  current.current = ownerId;
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (!open || state?.owner === ownerId) return;
        void list()
          .then((items) => {
            if (current.current === ownerId)
              setState({
                owner: ownerId,
                items: items.filter(
                  (p) =>
                    ["owner", "editor"].includes(p.role) &&
                    !p.archived_at &&
                    !p.deletion_requested_at,
                ),
                error: false,
              });
          })
          .catch(() => {
            if (current.current === ownerId) setState({ owner: ownerId, items: [], error: true });
          });
      }}
    >
      <DropdownMenuSubTrigger>
        <Folder className="mr-2 h-4 w-4" />
        Move to project
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className="kova-sidebar-chat-menu"
          // Keep nested targets stationary while the pointer crosses the parent menu's hover grace area.
          style={{ animation: "none", transition: "none" }}
        >
          <DropdownMenuItem asChild>
            <Link to="/projects" search={{ new: true }}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New project
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {state?.owner !== ownerId ? (
            <DropdownMenuItem disabled>Loading projects…</DropdownMenuItem>
          ) : state.error ? (
            <DropdownMenuItem onSelect={() => setState(null)}>
              Couldn't load projects. Retry
            </DropdownMenuItem>
          ) : state.items.length ? (
            state.items.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => onSelect(p.id)}>
                <Folder className="mr-2 h-4 w-4" />
                <span className="max-w-52 truncate">{p.name}</span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
