// Family Sharing UI panel — lives inside Settings > Family tab.
// Renders group state, member list, and an invite creator.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function FamilySharingPanel() {
  const { tier } = useTier();
  const [state, setState] = useState<FamilyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await getMyFamily();
      setState(s);
    } catch (e) {
      const msg = (e as Error).message || "Could not load your family group.";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const isPaid = tier === "plus" || tier === "pro";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading family center...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>Try again</Button>
      </div>
    );
  }


  const group = state?.group;
  const role = state?.role;
  const members = state?.members ?? [];
  const invites = state?.invites ?? [];

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted border border-border/60 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Family Sharing</h3>
            <p className="text-xs text-muted-foreground">
              Share KovaGPT Plus or Pro with up to 5 family members. Each member keeps
              their own private chats — only the plan is shared.
            </p>
          </div>
        </div>

        {!group && !isPaid && (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Family Sharing requires an active Plus or Pro subscription. Upgrade to invite members.
          </div>
        )}

        {!group && isPaid && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createFamilyGroup({ data: { name: "My Family" } });
                toast.success("Family group created.");
                await refresh();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create family group
          </Button>
        )}

        {group && (
          <>
            <div className="text-xs text-muted-foreground">
              You are the <span className="font-medium text-foreground">{role}</span> of{" "}
              <span className="font-medium text-foreground">{group.name}</span>.
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Members ({members.length}/6)
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-mono text-xs">{m.user_id.slice(0, 8)}…</span>
                      <span className="text-xs text-muted-foreground">({m.role})</span>
                    </div>
                    {role === "owner" && m.role !== "owner" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await removeFamilyMember({ data: { memberUserId: m.user_id } });
                            await refresh();
                          } catch (e) { toast.error((e as Error).message); }
                          finally { setBusy(false); }
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {role === "owner" && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Create an invite link
                </div>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="family@example.com (optional)"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const { token } = await createFamilyInvite({
                          data: inviteEmail.trim() ? { email: inviteEmail.trim() } : {},
                        });
                        const link = `${window.location.origin}/?family_invite=${token}`;
                        await navigator.clipboard.writeText(link).catch(() => {});
                        toast.success("Invite link copied to clipboard.");
                        setInviteEmail("");
                        await refresh();
                      } catch (e) { toast.error((e as Error).message); }
                      finally { setBusy(false); }
                    }}
                  >
                    Generate link
                  </Button>
                </div>

                {invites.length > 0 && (
                  <div className="space-y-1 pt-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Pending invites
                    </div>
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {invites.filter((i) => !i.accepted_at).map((inv) => {
                        const link = `${window.location.origin}/?family_invite=${inv.token}`;
                        const expired = new Date(inv.expires_at).getTime() < Date.now();
                        return (
                          <div key={inv.id} className="flex items-center justify-between px-3 py-2 gap-2 text-sm">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-muted-foreground">
                                {inv.invited_email || "Anyone with the link"} · {expired ? "expired" : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => {
                                navigator.clipboard.writeText(link).catch(() => {});
                                toast.success("Copied");
                              }}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await revokeFamilyInvite({ data: { inviteId: inv.id } });
                                  await refresh();
                                } catch (e) { toast.error((e as Error).message); }
                                finally { setBusy(false); }
                              }}
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {role === "member" && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await leaveFamily();
                    toast.success("Left family group.");
                    await refresh();
                  } catch (e) { toast.error((e as Error).message); }
                  finally { setBusy(false); }
                }}
              >
                Leave family
              </Button>
            )}
          </>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground px-1">
        Members inherit the owner's Plus or Pro features. Each member has their own daily
        quotas, chats, and settings — nothing shared besides the plan.
      </p>
    </div>
  );
}
