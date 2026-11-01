import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Folder, FolderPlus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

export function ChatProjectSubmenu({
  ownerId,
  onSelect,
}: {
  ownerId: string;
  onSelect: (id: string) => void;
}) {
  const list = useServerFn(listProjects);
  const phone = useIsMobile();
  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);
  const [state, setState] = useState<{
    owner: string;
    items: ProjectSummary[];
    error: boolean;
  } | null>(null);
  const current = useRef(ownerId);
  current.current = ownerId;
  const loadProjects = (retry = false) => {
    if (!retry && state?.owner === ownerId) return;
    void list()
      .then((items) => {
        if (current.current === ownerId)
          setState({
            owner: ownerId,
            items: items.filter(
              (p) =>
                ["owner", "editor"].includes(p.role) && !p.archived_at && !p.deletion_requested_at,
            ),
            error: false,
          });
      })
      .catch(() => {
        if (current.current === ownerId) setState({ owner: ownerId, items: [], error: true });
      });
  };
  const choices = (
    <>
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
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            loadProjects(true);
          }}
        >
          Couldn't load projects. Retry
        </DropdownMenuItem>
      ) : state.items.length ? (
        state.items.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onSelect(p.id)}>
            <Folder className="mr-2 h-4 w-4" />
            <span className="min-w-0 max-w-52 truncate">{p.name}</span>
          </DropdownMenuItem>
        ))
      ) : (
        <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
      )}
    </>
  );
  // A phone cannot fit two full-width menus side by side. Keep its choices in
  // the existing scrollable menu so taps never cross a narrow hover grace area.
  if (phone) {
    const expanded = expandedOwner === ownerId;
    return (
      <>
        <DropdownMenuItem
          aria-expanded={expanded}
          onSelect={(event) => {
            event.preventDefault();
            setExpandedOwner(expanded ? null : ownerId);
            if (!expanded) loadProjects();
          }}
        >
          <Folder className="mr-2 h-4 w-4" />
          Move to project
          <ChevronDown className="ml-auto" />
        </DropdownMenuItem>
        {expanded && (
          <DropdownMenuGroup
            aria-label="Project choices"
            className="ml-2 border-l border-border pl-2"
          >
            {choices}
          </DropdownMenuGroup>
        )}
      </>
    );
  }
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) loadProjects();
      }}
    >
      <DropdownMenuSubTrigger>
        <Folder className="mr-2 h-4 w-4" />
        Move to project
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className="kova-sidebar-chat-menu"
          style={{ animation: "none", transition: "none" }}
        >
          {choices}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
