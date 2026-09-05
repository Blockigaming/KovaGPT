import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Download, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  organizationErrorMessage,
  organizationRequest,
  OrganizationRequestError,
  type OrganizationMutation,
  type OrganizationRole,
  type OrganizationWorkspace,
} from "@/lib/organization-client";

export default function OrganizationAdminPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <WorkspacePageHeader
          icon={Building2}
          title="Organization"
          description="Manage explicit membership and organization administration."
        />
        {!isLoaded ? (
          <p role="status">Loading account…</p>
        ) : isSignedIn && user ? (
          <OrganizationContent key={user.id} userId={user.id} />
        ) : (
          <div className="rounded-xl border p-6">
            <p className="mb-3">Sign in with a verified account to view organization access.</p>
            <SignInButton />
          </div>
        )}
      </main>
    </AppShell>
  );
}
function OrganizationContent({ userId }: { userId: string }) {
  const [index, setIndex] = useState<OrganizationWorkspace | null>(null),
    [workspace, setWorkspace] = useState<OrganizationWorkspace | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [retry, setRetry] = useState<OrganizationMutation | null>(null);
  const [name, setName] = useState(""),
    [newName, setNewName] = useState(""),
    [email, setEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<OrganizationRole>("member"),
    [domain, setDomain] = useState(""),
    [retention, setRetention] = useState("365"),
    [confirmation, setConfirmation] = useState("");
  const controller = useRef(new AbortController()),
    readEpoch = useRef(0);
  const refresh = useCallback(
    async (organizationId: string | null) => {
      const epoch = ++readEpoch.current;
      setWorkspace(null);
      setSelected(organizationId);
      setRetry(null);
      setConfirmation("");
      setError(null);
      try {
        const data = await organizationRequest<OrganizationWorkspace>(
          userId,
          "/api/organizations",
          controller.current.signal,
        );
        if (epoch !== readEpoch.current || controller.current.signal.aborted) return;
        setIndex(data);
        if (!data.available) {
          setWorkspace(null);
          setSelected(null);
          return;
        }
        const current =
          organizationId && data.organizations?.some((item) => item.id === organizationId)
            ? organizationId
            : null;
        setSelected(current);
        if (current) {
          const detail = await organizationRequest<OrganizationWorkspace>(
            userId,
            `/api/organizations?organizationId=${current}`,
            controller.current.signal,
          );
          if (epoch !== readEpoch.current || controller.current.signal.aborted) return;
          setWorkspace(detail);
          setNewName(detail.organization?.name ?? "");
        } else setWorkspace(null);
      } catch (cause) {
        if (!controller.current.signal.aborted && epoch === readEpoch.current)
          setError(organizationErrorMessage(cause));
      }
    },
    [userId],
  );
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void refresh(null);
    return () => active.abort();
  }, [refresh]);
  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    organizationId = selected,
    revision = workspace?.organization?.revision,
  ) {
    if (busy || !organizationId || revision === undefined) return;
    if (
      !["create", "acceptInvite", "declineInvite"].includes(action) &&
      (workspace?.organization?.id !== selected || organizationId !== workspace.organization.id)
    )
      return;
    await submit({
      action,
      organizationId,
      expectedRevision: revision,
      mutationId: crypto.randomUUID(),
      payload,
    });
  }
  async function submit(body: OrganizationMutation) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setRetry(null);
    try {
      await organizationRequest(userId, "/api/organizations", controller.current.signal, body);
      if (controller.current.signal.aborted) return;
      setNotice("Organization changes saved.");
      setEmail("");
      setDomain("");
      await refresh(
        body.action === "close" || body.action === "leave" ? null : body.organizationId,
      );
    } catch (cause) {
      if (controller.current.signal.aborted) return;
      setError(organizationErrorMessage(cause));
      if (!(cause instanceof OrganizationRequestError) || cause.status >= 500) setRetry(body);
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function exportAudit() {
    if (!selected || busy || workspace?.organization?.id !== selected) return;
    setBusy(true);
    setError(null);
    const events: unknown[] = [];
    let cursor = 0,
      through: number | null = null,
      hasMore = false;
    try {
      for (let page = 0; page < 50; page++) {
        const params = new URLSearchParams({
          organizationId: selected,
          view: "audit",
          limit: "200",
          cursor: String(cursor),
        });
        if (through !== null) params.set("through", String(through));
        const result = await organizationRequest<{
          events: unknown[];
          nextCursor: number;
          through: number;
          hasMore: boolean;
        }>(userId, `/api/organizations?${params}`, controller.current.signal);
        events.push(...result.events);
        cursor = result.nextCursor;
        through = result.through;
        hasMore = result.hasMore;
        if (!hasMore) break;
      }
      if (controller.current.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { organizationId: selected, through, complete: !hasMore, events },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `organization-audit-${selected}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        hasMore
          ? "Exported the first 10,000 events. The file is marked incomplete."
          : `Exported ${events.length} audit events.`,
      );
    } catch (cause) {
      if (!controller.current.signal.aborted) setError(organizationErrorMessage(cause));
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  const org = workspace?.organization,
    owner = org?.role === "owner",
    admin = owner || org?.role === "admin";
  return (
    <div className="space-y-5" aria-busy={busy}>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{error}</p>
          {retry && (
            <Button
              className="mt-3"
              variant="outline"
              disabled={busy}
              onClick={() => void submit(retry)}
            >
              Retry the same request
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {!index ? (
        <p role="status">Loading organization availability…</p>
      ) : !index.available ? (
        <section className="rounded-2xl border bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">
            Organization administration is not available yet
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Organization access is awaiting service configuration and an approved administration
            policy. Personal accounts continue to work independently.
          </p>
          <p className="mt-3 text-sm">
            Enterprise requirements and commercial terms are confirmed separately.
          </p>
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Organization
              <select
                aria-label="Choose organization"
                value={selected ?? ""}
                disabled={busy}
                onChange={(event) => {
                  setWorkspace(null);
                  setRetry(null);
                  void refresh(event.target.value || null);
                }}
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
              >
                <option value="">Choose an organization</option>
                {index.organizations?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.role}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" disabled={busy} onClick={() => void refresh(selected)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </section>
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">Create an organization</summary>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate("create", { name }, crypto.randomUUID(), 0);
              }}
            >
              <Input
                aria-label="New organization name"
                maxLength={100}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-w-40 flex-1"
              />
              <Button disabled={busy || !name.trim()}>Create</Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              This creates administration records. It does not add a paid Enterprise plan.
            </p>
          </details>
          {!!index.invitations?.length && (
            <section className="rounded-xl border p-4">
              <h2 className="font-semibold">Your invitations</h2>
              <ul className="mt-3 divide-y">
                {index.invitations.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p>{invite.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Invited as {invite.role} · expires{" "}
                        {new Date(invite.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          "acceptInvite",
                          { invitationId: invite.id },
                          invite.organization_id,
                          invite.revision,
                        )
                      }
                    >
                      Accept invitation
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          "declineInvite",
                          { invitationId: invite.id },
                          invite.organization_id,
                          invite.revision,
                        )
                      }
                    >
                      Decline
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {org && (
            <>
              <section className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{org.name}</h2>
                    <p className="text-sm text-muted-foreground">Your role: {org.role}</p>
                  </div>
                  {admin && (
                    <Button variant="outline" disabled={busy} onClick={() => void exportAudit()}>
                      <Download className="mr-2 h-4 w-4" />
                      Export audit history
                    </Button>
                  )}
                </div>
                {owner && (
                  <form
                    className="mt-4 flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate("rename", { name: newName });
                    }}
                  >
                    <label className="flex-1 text-sm">
                      Organization name
                      <Input
                        value={newName}
                        maxLength={100}
                        required
                        disabled={busy}
                        onChange={(event) => setNewName(event.target.value)}
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={busy || !newName.trim() || newName.trim() === org.name}
                    >
                      Save name
                    </Button>
                  </form>
                )}
                <ul className="mt-4 divide-y">
                  {workspace.members?.map((member) => (
                    <li
                      key={member.user_id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="break-all text-sm">
                          {member.user_id === userId ? "You" : member.user_id}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {owner && (
                          <select
                            aria-label={`Role for ${member.user_id}`}
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void mutate("setRole", {
                                userId: member.user_id,
                                role: event.target.value,
                              })
                            }
                            className="h-9 rounded-lg border bg-background px-2 text-sm"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                        )}
                        {admin &&
                          member.user_id !== userId &&
                          (owner || member.role === "member") && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void mutate("removeMember", { userId: member.user_id })
                              }
                            >
                              Remove member
                            </Button>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void mutate("leave", {})}
                >
                  Leave organization
                </Button>
              </section>
              {admin && (
                <section className="rounded-xl border p-4">
                  <h2 className="font-semibold">Invite an existing account</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Invitations appear in the recipient’s Organization page. The recipient must have
                    a verified email and explicitly accept. No email is sent.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate("invite", { email, role: inviteRole });
                    }}
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    <Input
                      aria-label="Recipient verified email"
                      type="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="min-w-40 flex-1"
                    />
                    <select
                      aria-label="Invitation role"
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as OrganizationRole)}
                      className="h-10 rounded-lg border bg-background px-2"
                    >
                      <option value="member">Member</option>
                      {owner && (
                        <>
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </>
                      )}
                    </select>
                    <Button disabled={busy}>Create invitation</Button>
                  </form>
                  <ul className="mt-3 divide-y">
                    {workspace.pendingInvitations?.map((invite) => (
                      <li
                        key={invite.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                      >
                        <span className="break-all">
                          {invite.recipient_user_id} · {invite.role}
                        </span>
                        {(owner || invite.role === "member") && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void mutate("revokeInvite", { invitationId: invite.id })}
                          >
                            Revoke
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {owner && (
                <>
                  <section className="rounded-xl border p-4">
                    <h2 className="font-semibold">Verified domains and SSO</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Domain verification proves DNS control. It never makes people members
                      automatically. SSO also requires a configured provider.
                    </p>
                    <form
                      className="mt-3 flex flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate("claimDomain", { domain });
                      }}
                    >
                      <Input
                        aria-label="Organization domain"
                        placeholder="example.com"
                        value={domain}
                        onChange={(event) => setDomain(event.target.value)}
                        required
                        maxLength={253}
                        className="min-w-40 flex-1"
                      />
                      <Button disabled={busy}>Add domain</Button>
                    </form>
                    <ul className="mt-3 space-y-3">
                      {workspace.domains?.map((item) => (
                        <li key={item.id} className="rounded-lg bg-muted/35 p-3 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong>{item.domain}</strong>
                            <span>
                              {item.state === "verified" &&
                              Date.parse(item.verification_expires_at ?? "") > Date.now()
                                ? "Verified for 24 hours"
                                : "Verification required"}
                            </span>
                          </div>
                          <p className="mt-2 break-all text-xs">
                            TXT host: _kovagpt-verification.{item.domain}
                          </p>
                          <p className="mt-1 break-all font-mono text-xs">
                            kovagpt-domain={item.challenge_token}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void mutate("verifyDomain", { domainId: item.id })}
                            >
                              Check DNS
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || item.state !== "verified"}
                              onClick={() => void mutate("configureSso", { domainId: item.id })}
                            >
                              Configure SSO connection
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void mutate("revokeDomain", { domainId: item.id })}
                            >
                              Revoke domain
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm">
                      SSO:{" "}
                      {workspace.sso?.state === "configured" && workspace.sso.verified
                        ? "Connection recorded; provider sign-in setup is managed separately"
                        : "Not active"}
                    </p>
                    {workspace.sso?.state === "configured" && (
                      <Button
                        className="mt-2"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void mutate("disableSso", {})}
                      >
                        Disable SSO connection
                      </Button>
                    )}
                  </section>
                  <section className="rounded-xl border p-4">
                    <h2 className="font-semibold">Retention proposal</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Saved as a draft. This does not delete content or activate retention
                      enforcement.
                    </p>
                    <p className="mt-2 text-sm">
                      Current proposal:{" "}
                      {org.retentionDaysDraft ? `${org.retentionDaysDraft} days` : "None"}
                    </p>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate("saveRetentionDraft", { days: Number(retention) });
                      }}
                    >
                      <Input
                        aria-label="Proposed retention days"
                        type="number"
                        min={1}
                        max={3650}
                        required
                        value={retention}
                        onChange={(event) => setRetention(event.target.value)}
                        className="max-w-36"
                      />
                      <Button disabled={busy}>Save draft</Button>
                    </form>
                  </section>
                  {index.canClose && (
                    <details className="rounded-xl border border-destructive/30 p-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Close organization
                      </summary>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Only a sole remaining owner can close the organization. This revokes access
                        and invitations; retained audit records are not erased. Type {org.name} to
                        confirm.
                      </p>
                      <Input
                        className="mt-3"
                        aria-label="Organization name confirmation"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                      <Button
                        className="mt-3"
                        variant="destructive"
                        disabled={busy || confirmation !== org.name}
                        onClick={() => void mutate("close", { confirmation })}
                      >
                        Close organization
                      </Button>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
