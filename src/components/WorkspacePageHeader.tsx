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
      <div className="kova-page-identity flex min-w-0 flex-1 min-[641px]:basis-80 items-start gap-3">
        {Icon ? (
          <span
            className="kova-page-icon mt-1 grid h-6 w-6 shrink-0 place-items-center text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
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
