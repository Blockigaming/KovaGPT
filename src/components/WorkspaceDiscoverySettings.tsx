import { useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  findAvailableWorkspaces,
  submitWorkspaceJoinRequest,
  type AvailableWorkspace,
} from "@/lib/workspace-join.functions";

/** Only server-confirmed, verified-domain matches appear in Settings. */
export function WorkspaceDiscoverySettings() {
  const [workspaces, setWorkspaces] = useState<AvailableWorkspace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void findAvailableWorkspaces()
      .then((matches) => {
        if (!cancelled) setWorkspaces(matches);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
          <UsersRound className="h-5 w-5" />
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
                    : "Not a member"}
              </p>
            </div>
            <Button
              type="button"
              className="min-h-11 rounded-full px-4 text-sm"
              disabled={busy !== null || pending || approved}
              onClick={async () => {
                setError("");
                setBusy(workspace.team_id);
                try {
                  const result = await submitWorkspaceJoinRequest({
                    data: { teamId: workspace.team_id },
                  });
                  if (result.status !== "pending") throw new Error("Request not confirmed");
                  setWorkspaces((current) =>
                    current.map((item) =>
                      item.team_id === workspace.team_id
                        ? { ...item, request_status: "pending" }
                        : item,
                    ),
                  );
                  publishKovaNotice({
                    id: "workspace_join_requested",
                    title: "Workspace request submitted",
                    message: "An administrator can review the request in team settings.",
                    confirmed: true,
                  });
                } catch {
                  setError(
                    "The request could not be confirmed. Review your connection and try again.",
                  );
                } finally {
                  setBusy(null);
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
