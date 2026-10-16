import { useContext, type ReactNode } from "react";
import { WorkspacePageUtilities } from "@/components/WorkspacePageUtilities";
import type { LucideIcon } from "lucide-react";

export function WorkspacePageHeader({
  icon: Icon,
  title,
  description,
  actions,
  meta,
  titleId,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  meta?: ReactNode;
  titleId?: string;
}) {
  const utilities = useContext(WorkspacePageUtilities);
  return (
    <header className="kova-page-header" aria-labelledby={titleId}>
      <div className="flex min-w-0 flex-1 min-[641px]:basis-80 items-start gap-3">
        {Icon ? (
          <span
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/45 text-foreground"
            aria-hidden="true"
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 id={titleId} className="kova-page-title">
            {title}
          </h1>
          <p className="kova-page-description">{description}</p>
          {meta ? <div className="mt-1 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
      </div>
      {actions || utilities ? (
        <div className="kova-page-actions ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
          {utilities}
        </div>
      ) : null}
    </header>
  );
}
