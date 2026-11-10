import { useEffect, useState } from "react";
import { Building2, Clock3 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspaceDiscovery } from "@/lib/workspace-discovery-client";

export function FindWorkspacesDialog({ userId, open, onOpenChange }: {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { workspaces, pendingId, loading, error, requestJoin, refresh } =
    useWorkspaceDiscovery(open ? userId : null);
  useEffect(() => {
    if (open && userId) void refresh().catch(() => {});
  }, [open, userId, refresh]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-[460px] max-h-[85dvh] overflow-y-auto rounded-3xl p-5 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Find workspaces</DialogTitle>
          <DialogDescription>
            Request to join an organization verified for your email domain.
            A workspace owner will review your request before you can join.
          </DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="text-sm text-muted-foreground">Checking workspaces…</p>
          : workspaces.length ? (
            <ul className="space-y-2" aria-label="Matching workspaces">
              {workspaces.map((workspace) => (
                <li key={workspace.id}
                  className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border p-3">
                  <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words font-medium">{workspace.name}</span>
                  {workspace.status === "pending"
                    ? <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock3 size={15} aria-hidden="true" /> Requested
                      </span>
                    : workspace.status === "declined"
                      ? <span className="text-sm text-muted-foreground">Declined</span>
                      : <Button size="sm" className="rounded-full" disabled={Boolean(pendingId)}
                          onClick={() => void requestJoin(workspace.id)}>
                          {pendingId === workspace.id ? "Sending…" : "Request to join"}
                        </Button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No verified workspaces are available.</p>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceDiscoverySettings({ userId }: { userId: string | null }) {
  const { workspaces, loading } = useWorkspaceDiscovery(userId);
  const [open, setOpen] = useState(false);
  // Only a real, server-confirmed matching workspace may expose this action.
  if (loading || !workspaces.length) return null;
  return (
    <section className="rounded-2xl border border-border p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="font-medium">Find workspaces</h3>
          <p className="text-sm text-muted-foreground">Your email matches a verified organization domain.</p>
        </div>
      </div>
      <Button type="button" variant="outline" className="rounded-full"
        onClick={() => setOpen(true)}>Find workspaces</Button>
      <FindWorkspacesDialog userId={userId} open={open} onOpenChange={setOpen} />
    </section>
  );
}
