import { useLayoutEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  submitWorkspaceJoinRequest,
  type AvailableWorkspace,
  type JoinRequestStatus,
} from "@/lib/workspace-join.functions";

export function WorkspaceJoinDialog({
  ownerId,
  workspaces,
  open,
  onClose,
  onRequested,
}: {
  ownerId: string;
  workspaces: AvailableWorkspace[];
  open: boolean;
  onClose: () => void;
  onRequested: (teamId: string, status: JoinRequestStatus) => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef({ active: true, pending: false });
  useLayoutEffect(() => {
    const scope = operation.current;
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, []);
  if (!workspaces.length) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent
        data-kova-notice-id={open ? "join_workspace_offer" : undefined}
        className="max-w-[460px] gap-0 rounded-[22px] border border-border bg-popover p-6 text-popover-foreground max-sm:!bottom-0 max-sm:!top-auto max-sm:!left-0 max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!rounded-t-[26px] max-sm:!px-5 max-sm:!pb-[calc(20px+env(safe-area-inset-bottom))]"
      >
        <div
          className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-secondary"
          aria-hidden="true"
        >
          <Users className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Join your workspace?
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            A KovaGPT workspace has verified your email domain. Request access from its
            administrator; joining is never automatic.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 max-h-[44dvh] space-y-2 overflow-y-auto overscroll-contain">
          {workspaces.map((workspace) => {
            const pending = workspace.request_status === "pending";
            const approved = workspace.request_status === "approved";
            return (
              <div
                key={workspace.team_id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/20 p-3"
              >
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{workspace.team_name}</strong>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {pending
                      ? "Request awaiting review"
                      : approved
                        ? "Approved — administrator invitation required"
                        : workspace.request_status === "denied"
                          ? "A previous request was denied"
                          : "Verified domain association"}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 rounded-full px-4"
                  disabled={pending || approved || submitting !== null}
                  aria-label={`Request to join ${workspace.team_name}`}
                  onClick={async () => {
                    const scope = operation.current;
                    if (!scope.active || scope.pending) return;
                    scope.pending = true;
                    setError(null);
                    setSubmitting(workspace.team_id);
                    try {
                      const result = await submitWorkspaceJoinRequest({
                        data: { teamId: workspace.team_id, expectedUserId: ownerId },
                      });
                      if (!scope.active) return;
                      onRequested(workspace.team_id, result.status);
                      if (result.status !== "pending") return;
                      publishKovaNotice({
                        id: "workspace_join_requested",
                        title: "Request submitted",
                        message: "The workspace administrator can review your request.",
                        confirmed: true,
                        key: "workspace-join:" + result.id,
                      });
                    } catch {
                      if (!scope.active) return;
                      setError(
                        "Your request could not be confirmed. Check your connection and try again.",
                      );
                      publishKovaNotice({
                        id: "workspace_join_failed",
                        title: "Workspace request could not be confirmed",
                      });
                    } finally {
                      scope.pending = false;
                      if (scope.active) setSubmitting(null);
                    }
                  }}
                >
                  {submitting === workspace.team_id
                    ? "Sending…"
                    : pending
                      ? "Requested"
                      : approved
                        ? "Approved"
                        : "Request to join"}
                </Button>
              </div>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          className="mt-6 min-h-12 w-full rounded-full"
          disabled={submitting !== null}
          onClick={() => {
            setError(null);
            onClose();
          }}
        >
          Not now
        </Button>
      </DialogContent>
    </Dialog>
  );
}
