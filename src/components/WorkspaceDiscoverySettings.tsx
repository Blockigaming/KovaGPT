import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  findAvailableWorkspaces,
  submitWorkspaceJoinRequest,
  type AvailableWorkspace,
} from "@/lib/workspace-join.functions";

/** Only server-confirmed, verified-domain matches appear in Settings. */
export function WorkspaceDiscoverySettings({ ownerId }: { ownerId: string }) {
  const [workspaces, setWorkspaces] = useState<AvailableWorkspace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const operation = useRef({ active: true, pending: false });
  useLayoutEffect(() => {
    const scope = operation.current;
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void findAvailableWorkspaces({ data: { expectedUserId: ownerId } })
      .then((matches) => {
        if (!cancelled) setWorkspaces(matches);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  if (!workspaces.length) return null;
  return (
    <section
      className="space-y-3 rounded-[20px] border border-border bg-muted/20 p-4"
      aria-label="Find workspaces"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary"
          aria-hidden="true"
        >
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Find workspaces</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            These KovaGPT workspaces have a verified association with your email domain.
          </p>
        </div>
      </div>
      {workspaces.map((workspace) => {
        const pending = workspace.request_status === "pending";
        const approved = workspace.request_status === "approved";
        return (
          <div
            key={workspace.team_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/40 px-3 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{workspace.team_name}</div>
              <p className="text-xs text-muted-foreground">
                {pending
                  ? "Request pending"
                  : approved
                    ? "Approved — awaiting invitation"
                    : workspace.request_status === "denied"
                      ? "A previous request was denied"
                      : "Not a member"}
              </p>
            </div>
            <Button
              type="button"
              className="min-h-11 rounded-full px-4 text-sm"
              disabled={busy !== null || pending || approved}
              onClick={async () => {
                const scope = operation.current;
                if (!scope.active || scope.pending) return;
                scope.pending = true;
                setError("");
                setBusy(workspace.team_id);
                try {
                  const result = await submitWorkspaceJoinRequest({
                    data: { teamId: workspace.team_id, expectedUserId: ownerId },
                  });
                  if (!scope.active) return;
                  setWorkspaces((current) =>
                    current.map((item) =>
                      item.team_id === workspace.team_id
                        ? { ...item, request_status: result.status }
                        : item,
                    ),
                  );
                  if (result.status !== "pending") return;
                  publishKovaNotice({
                    id: "workspace_join_requested",
                    title: "Workspace request submitted",
                    message: "An administrator can review the request in team settings.",
                    confirmed: true,
                    key: "workspace-join:" + result.id,
                  });
                } catch {
                  if (!scope.active) return;
                  setError(
                    "The request could not be confirmed. Review your connection and try again.",
                  );
                  publishKovaNotice({
                    id: "workspace_join_failed",
                    title: "Workspace request could not be confirmed",
                  });
                } finally {
                  scope.pending = false;
                  if (scope.active) setBusy(null);
                }
              }}
            >
              {busy === workspace.team_id
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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Joining requires administrator approval and a separate membership invitation.
      </p>
    </section>
  );
}
