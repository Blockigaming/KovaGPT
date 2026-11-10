import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  declineWorkspaceJoinRequest, listWorkspaceJoinRequests,
  type WorkspaceJoinRequest,
} from "@/lib/workspace-discovery-client";
import { organizationRequest } from "@/lib/organization-client";

export function OrganizationJoinInbox({
  userId, organizationId, revision, onInvited,
}: {
  userId: string; organizationId: string; revision: number;
  onInvited: () => void;
}) {
  const [requests, setRequests] = useState<WorkspaceJoinRequest[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    setRequests([]);
    setError("");
    void listWorkspaceJoinRequests(userId, organizationId)
      .then((items) => { if (mounted) setRequests(items); })
      .catch(() => { if (mounted) setError("Join requests could not be loaded."); });
    return () => { mounted = false; };
  }, [userId, organizationId, revision]);

  async function review(request: WorkspaceJoinRequest, action: "invite" | "decline") {
    if (busy) return;
    setBusy(request.id); setError(""); setNotice("");
    try {
      if (action === "invite") {
        // Reuse the existing checked invitation flow. No membership is granted here.
        await organizationRequest(userId, "/api/organizations", new AbortController().signal, {
          action: "invite",
          organizationId,
          expectedRevision: revision,
          mutationId: crypto.randomUUID(),
          payload: { email: request.requesterEmail, role: "member" },
        });
        setNotice("Invitation created. The requester must accept it to join.");
        onInvited();
      } else {
        await declineWorkspaceJoinRequest(userId, request.id);
        setNotice("Request declined.");
      }
      setRequests(await listWorkspaceJoinRequests(userId, organizationId));
    } catch {
      setError("The review could not be confirmed. Refresh to check the current status.");
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-border p-4 space-y-3"
      aria-label="Requests to join this workspace">
      <h3 className="font-semibold">Requests to join</h3>
      <p className="text-sm text-muted-foreground">
        These accounts share your verified workspace domain. Inviting one requires explicit acceptance.
      </p>
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {requests.length === 0 ? <p className="text-sm text-muted-foreground">No pending requests.</p>
        : <ul className="divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 break-all text-sm">{request.requesterEmail}</span>
                <Button size="sm" className="rounded-full" disabled={Boolean(busy)}
                  onClick={() => void review(request, "invite")}>
                  {busy === request.id ? "Reviewing…" : "Send invitation"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-full"
                  disabled={Boolean(busy)} onClick={() => void review(request, "decline")}>Decline</Button>
              </li>
            ))}
          </ul>}
    </section>
  );
}
