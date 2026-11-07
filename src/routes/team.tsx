import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTeamWorkspace,
  createTeamCheckout,
  createTeamPortal,
  cancelTeamCheckout,
  mutateTeamMember,
  type TeamWorkspaceView,
} from "@/lib/team-billing.functions";
import { validateTeamSelection, teamCheckoutUrl } from "@/lib/team-billing-policy.mjs";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";

export const Route = createFileRoute("/team")({ component: TeamPage });
function TeamPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto min-h-dvh w-full max-w-5xl space-y-8 px-4 py-6 sm:px-8"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">KovaGPT Team</h1>
        <Link
          className="inline-flex min-h-11 items-center rounded-full border border-border px-5"
          to="/"
        >
          Back to chat
        </Link>
      </header>
      {!isLoaded ? (
        <p role="status">Loading your account…</p>
      ) : !owner ? (
        <SignInButton mode="modal">
          <Button>Sign in to manage your team</Button>
        </SignInButton>
      ) : (
        <TeamWorkspace key={owner} owner={owner} />
      )}
    </main>
  );
}
function TeamWorkspace({ owner }: { owner: string }) {
  const [workspace, setWorkspace] = useState<TeamWorkspaceView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const [name, setName] = useState("My team");
  const [standard, setStandard] = useState(2),
    [premium, setPremium] = useState(0);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [email, setEmail] = useState(""),
    [seat, setSeat] = useState<"standard" | "premium">("standard");
  const [seatChanges, setSeatChanges] = useState<
    Record<string, { standard: number; premium: number }>
  >({});
  const read = useServerFn(getTeamWorkspace),
    checkout = useServerFn(createTeamCheckout),
    portal = useServerFn(createTeamPortal),
    cancel = useServerFn(cancelTeamCheckout),
    mutate = useServerFn(mutateTeamMember);
  async function refresh() {
    const result = await read();
    if (active.current) setWorkspace(result);
  }
  useEffect(() => {
    active.current = true;
    void refresh().catch(() => {
      if (active.current)
        setError("Your team could not be loaded. Retry to check billing and invitations.");
    });
    return () => {
      active.current = false;
    };
    // The keyed workspace owns one verified account lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  async function act(operation: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      if (active.current)
        setError(reason instanceof Error ? reason.message : "The change could not be confirmed.");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  function navigate(url: string) {
    if (active.current) window.location.assign(url);
  }
  const total =
    standard * (interval === "year" ? 20 : 25) + premium * (interval === "year" ? 100 : 125);
  const ownsTeam = workspace?.teams.some(
    (t) =>
      t.owner &&
      [
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "paused",
        "incomplete",
        "billing_review",
      ].includes(t.status),
  );
  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="space-y-3 rounded-2xl border border-destructive/40 p-4">
          <p>{error}</p>
          <Button variant="outline" disabled={busy} onClick={() => void act(refresh)}>
            Refresh workspace
          </Button>
        </div>
      )}
      {!workspace && !error && <p role="status">Checking billing and invitations…</p>}
      {workspace?.invitations.map((invite) => (
        <section
          key={invite.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border p-5"
        >
          <div>
            <h2 className="font-semibold">Invitation to {invite.name}</h2>
            <p className="text-sm text-muted-foreground">{invite.seat} seat</p>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await mutate({ data: { teamId: invite.id, action: "accept", seat: "standard" } });
                await refresh();
              })
            }
          >
            Accept invitation
          </Button>
        </section>
      ))}
      {workspace?.teams.map((team) => (
        <section key={team.id} className="space-y-5 rounded-3xl border border-border p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold">{team.name}</h2>
            <p className="text-sm text-muted-foreground">
              {team.status} · {team.standard} Standard · {team.premium} Premium seats
            </p>
          </div>
          {team.owner && (
            <>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await portal({ data: { teamId: team.id } });
                      const url = parseAllowedBillingPortalUrl(result.url);
                      if (!url) throw new Error("Secure billing could not open.");
                      navigate(url);
                    })
                  }
                >
                  Manage billing
                </Button>
                {team.status === "pending" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await cancel({ data: { teamId: team.id } });
                        await refresh();
                      })
                    }
                  >
                    Cancel pending checkout
                  </Button>
                )}
              </div>
              {["active", "trialing"].includes(team.status) && (
                <>
                  <form
                    className="space-y-4 rounded-2xl bg-muted/40 p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(async () => {
                        const counts = seatChanges[team.id] ?? {
                          standard: team.standard,
                          premium: team.premium,
                        };
                        const result = await portal({ data: { teamId: team.id, ...counts } });
                        const url = parseAllowedBillingPortalUrl(result.url);
                        if (!url) throw new Error("Secure billing could not open.");
                        navigate(url);
                      });
                    }}
                  >
                    <h3 className="font-medium">Add or change seats</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["standard", "premium"] as const).map((kind) => (
                        <label key={kind} className="text-sm capitalize">
                          {kind} seats
                          <Input
                            type="number"
                            min={0}
                            max={150}
                            value={seatChanges[team.id]?.[kind] ?? team[kind]}
                            onChange={(event) =>
                              setSeatChanges((value) => ({
                                ...value,
                                [team.id]: {
                                  ...(value[team.id] ?? {
                                    standard: team.standard,
                                    premium: team.premium,
                                  }),
                                  [kind]: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Stripe shows any prorated charge before you confirm. Reducing seats removes
                      excess assignments, starting with invitations and the newest members.
                    </p>
                    <Button type="submit" disabled={busy}>
                      Review seat change in Stripe
                    </Button>
                  </form>
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(async () => {
                        await mutate({ data: { teamId: team.id, action: "invite", email, seat } });
                        if (active.current) setEmail("");
                        await refresh();
                      });
                    }}
                  >
                    <h3 className="font-medium">Invite a member</h3>
                    <p className="text-sm text-muted-foreground">
                      Recipients need a verified KovaGPT account. They can accept the invitation on
                      this Team page. An invitation reserves a paid seat.
                    </p>
                    <label className="block text-sm">
                      Email
                      <Input
                        type="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Seat type
                      <select
                        className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3"
                        value={seat}
                        onChange={(event) => setSeat(event.target.value as typeof seat)}
                      >
                        <option value="standard">Standard</option>
                        <option value="premium">Premium</option>
                      </select>
                    </label>
                    <Button type="submit" disabled={busy || !email}>
                      Invite member
                    </Button>
                  </form>
                </>
              )}
              <ul className="divide-y divide-border">
                {team.members.map((member) => (
                  <li
                    key={member.user_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0 break-all text-sm">
                      {member.user_id === owner ? "You" : member.email || member.user_id} ·{" "}
                      {member.seat} · {member.state}
                    </span>
                    {member.user_id !== owner && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await mutate({
                              data: {
                                teamId: team.id,
                                action: "remove",
                                userId: member.user_id,
                                seat: "standard",
                              },
                            });
                            await refresh();
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
      {workspace && !ownsTeam && (
        <form
          className="space-y-5 rounded-3xl border border-border p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              validateTeamSelection({ standard, premium, interval });
              const result = await checkout({ data: { name, standard, premium, interval } });
              navigate(teamCheckoutUrl(result.url));
            });
          }}
        >
          <h2 className="text-2xl font-semibold">Start a team</h2>
          <label className="block text-sm">
            Team name
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Billing period
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3"
              aria-label="Billing period"
              value={interval}
              onChange={(event) => setInterval(event.target.value as typeof interval)}
            >
              <option value="month">Monthly</option>
              <option value="year">Annually</option>
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="rounded-2xl bg-muted p-4 text-left">
              Standard · ${interval === "year" ? 20 : 25} / seat / month
              <Input
                aria-label="Standard seats"
                type="number"
                min={0}
                max={150}
                value={standard}
                onChange={(event) => setStandard(Number(event.target.value))}
              />
            </label>
            <label className="rounded-2xl bg-muted p-4 text-left">
              Premium · ${interval === "year" ? 100 : 125} / seat / month
              <Input
                aria-label="Premium seats"
                type="number"
                min={0}
                max={150}
                value={premium}
                onChange={(event) => setPremium(Number(event.target.value))}
              />
            </label>
          </div>
          <p className="font-medium">
            {standard + premium} seats · ${interval === "year" ? total * 12 : total}{" "}
            {interval === "year" ? "per year" : "per month"}, plus applicable tax
          </p>
          <p className="text-sm text-muted-foreground">
            Choose 2–150 seats, including your own. Payment opens full-screen in Stripe. Team
            billing is separate from any personal subscription.
          </p>
          <Button className="rounded-full" type="submit" disabled={busy}>
            {busy ? "Opening…" : "Continue to Team payment"}
          </Button>
        </form>
      )}
    </div>
  );
}
