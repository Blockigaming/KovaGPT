// Account-scoped Family Sharing controls inside Settings.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { Users, Copy, X as XIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTier } from "@/hooks/useTier";
import {
  getMyFamily,
  createFamilyGroup,
  createFamilyInvite,
  removeFamilyMember,
  revokeFamilyInvite,
  leaveFamily,
} from "@/lib/family.functions";

type FamilyState = Awaited<ReturnType<typeof getMyFamily>>;
type FamilyChange = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<unknown>;
};

export function FamilySharingPanel() {
  const { isLoaded, user } = useUser();
  if (!isLoaded) return <p role="status">Checking your account...</p>;
  if (!user) return <p>Sign in to manage Family Sharing.</p>;
  return <AccountFamilySharingPanel key={user.id} />;
}

function AccountFamilySharingPanel() {
  const { tier, loading: tierLoading } = useTier();
  const [state, setState] = useState<FamilyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [change, setChange] = useState<FamilyChange | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const emailId = useId();
  const linkId = useId();

  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getMyFamily();
      if (activeRef.current && request === requestRef.current) setState(result);
    } catch {
      if (activeRef.current && request === requestRef.current) {
        setLoadError("Could not load your family group. Please try again.");
      }
    } finally {
      if (activeRef.current && request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void refresh();
    return () => {
      activeRef.current = false;
    };
  }, [refresh]);

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current || !activeRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (activeRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not complete this action.");
      }
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  async function copyInvite(link: string) {
    if (!activeRef.current) return;
    // Always retain a selectable fallback. Creating an invite is not proof of copying it.
    setManualLink(link);
    try {
      await navigator.clipboard.writeText(link);
      if (activeRef.current) toast.success("Invite link copied to clipboard.");
    } catch {
      if (activeRef.current) {
        toast.error("Copy is unavailable. Select and copy the invite link below.");
      }
    }
  }

  const inviteLinkFallback = manualLink ? (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <label htmlFor={linkId} className="block text-sm font-medium">
        Invite link
      </label>
      <Input
        id={linkId}
        readOnly
        value={manualLink}
        className="min-h-11"
        onFocus={(event) => event.currentTarget.select()}
        aria-describedby={`${linkId}-help`}
      />
      <p id={`${linkId}-help`} className="text-xs leading-5 text-muted-foreground">
        Select this link to copy it manually. Share it only with the family member you intend to
        invite.
      </p>
    </div>
  ) : null;

  const isPaid = tier === "plus" || tier === "pro";
  if (loading) {
    return (
      <div className="space-y-3">
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading family center...
        </div>
        {inviteLinkFallback}
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-3">
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {loadError}
        </p>
        {inviteLinkFallback}
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal text-center"
          onClick={() => void refresh()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const group = state?.group;
  const role = state?.role;
  const members = state?.members ?? [];
  const pendingInvites = (state?.invites ?? []).filter((invite) => !invite.accepted_at);

  return (
    <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]" aria-busy={busy}>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Family Sharing</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Share KovaGPT Plus or Pro with up to 5 family members. Each member keeps their own
              private chats; only the plan is shared.
            </p>
          </div>
        </div>

        {!group && tierLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking your plan...
          </p>
        ) : !group && !isPaid ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Family Sharing requires an active Plus or Pro subscription. Upgrade to invite members.
          </p>
        ) : !group ? (
          <Button
            type="button"
            className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal text-center"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                await createFamilyGroup({ data: { name: "My Family" } });
                if (!activeRef.current) return;
                toast.success("Family group created.");
                await refresh();
              })
            }
          >
            Create family group
          </Button>
        ) : null}

        {group ? (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              You are the <span className="font-medium text-foreground">{role}</span> of{" "}
              <span className="font-medium text-foreground">{group.name}</span>.
            </p>
            <section className="space-y-2" aria-label="Family members">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Members ({members.length}/6)
              </h4>
              <div className="divide-y divide-border rounded-xl border border-border">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{member.user_id.slice(0, 8)}…</span>
                      <span className="text-xs text-muted-foreground">({member.role})</span>
                    </div>
                    {role === "owner" && member.role !== "owner" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy}
                        aria-label={`Remove family member ${member.user_id.slice(0, 8)}`}
                        onClick={() =>
                          setChange({
                            title: "Remove family member?",
                            description:
                              "This member will lose the shared plan. Their private chats will not be deleted.",
                            confirmLabel: "Remove member",
                            run: () =>
                              removeFamilyMember({ data: { memberUserId: member.user_id } }),
                          })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            {role === "owner" ? (
              <section className="space-y-3" aria-label="Family invitations">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Create an invite link
                </h4>
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runAction(async () => {
                      const { token } = await createFamilyInvite({
                        data: inviteEmail.trim() ? { email: inviteEmail.trim() } : {},
                      });
                      if (!activeRef.current) return;
                      setInviteEmail("");
                      await copyInvite(
                        `${window.location.origin}/?family_invite=${encodeURIComponent(token)}`,
                      );
                      await refresh();
                    });
                  }}
                >
                  <label htmlFor={emailId} className="block text-sm font-medium">
                    Family member’s email{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id={emailId}
                      type="email"
                      autoComplete="email"
                      placeholder="family@example.com"
                      value={inviteEmail}
                      disabled={busy}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      className="min-h-11 min-w-0"
                    />
                    <Button
                      type="submit"
                      disabled={busy}
                      className="h-auto min-h-11 shrink-0 whitespace-normal"
                    >
                      Generate link
                    </Button>
                  </div>
                </form>
                {inviteLinkFallback}
                {pendingInvites.length > 0 ? (
                  <div className="space-y-2 pt-2">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pending invites
                    </h4>
                    <div className="divide-y divide-border rounded-xl border border-border">
                      {pendingInvites.map((invite) => {
                        const expires = new Date(invite.expires_at).getTime();
                        const canCopy = Number.isFinite(expires) && expires > Date.now();
                        const recipient = invite.invited_email || "anyone with this link";
                        return (
                          <div
                            key={invite.id}
                            className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1 basis-40 text-xs leading-5 text-muted-foreground">
                              {invite.invited_email || "Anyone with the link"} ·{" "}
                              {!Number.isFinite(expires)
                                ? "Expiration unavailable"
                                : canCopy
                                  ? `expires ${new Date(expires).toLocaleDateString()}`
                                  : "Expired"}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-11 w-11"
                                disabled={busy || !canCopy}
                                aria-label={`Copy invite for ${recipient}`}
                                onClick={() =>
                                  void runAction(() =>
                                    copyInvite(
                                      `${window.location.origin}/?family_invite=${encodeURIComponent(invite.token)}`,
                                    ),
                                  )
                                }
                              >
                                <Copy className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Revoke invite for ${recipient}`}
                                onClick={() =>
                                  setChange({
                                    title: "Revoke this invite?",
                                    description:
                                      "This link will stop working. You can generate a new invitation later.",
                                    confirmLabel: "Revoke invite",
                                    run: () =>
                                      revokeFamilyInvite({ data: { inviteId: invite.id } }),
                                  })
                                }
                              >
                                <XIcon className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            {role === "member" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="min-h-11 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setChange({
                    title: "Leave this family?",
                    description:
                      "You will lose access to the shared plan. Your private chats and settings will stay in your account.",
                    confirmLabel: "Leave family",
                    run: () => leaveFamily(),
                  })
                }
              >
                Leave family
              </Button>
            ) : null}
          </>
        ) : null}
      </section>
      <p className="px-1 text-xs leading-5 text-muted-foreground">
        Members inherit the owner's Plus or Pro features. Each member has their own daily quotas,
        chats, and settings; nothing is shared besides the plan.
      </p>
      <ConfirmActionDialog
        open={change !== null}
        onOpenChange={(open) => {
          if (!open) setChange(null);
        }}
        title={change?.title ?? "Confirm family change"}
        description={change?.description ?? ""}
        confirmLabel={change?.confirmLabel ?? "Confirm"}
        destructive
        disabled={busy}
        onConfirm={() => {
          const selected = change;
          if (!selected) return;
          void runAction(async () => {
            await selected.run();
            if (!activeRef.current) return;
            setManualLink(null);
            setChange(null);
            toast.success("Family updated.");
            await refresh();
          });
        }}
      />
    </div>
  );
}
