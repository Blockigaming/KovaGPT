import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Users, Mail, CreditCard, ArrowUpRight, Crown, Sparkles, Loader2 } from "lucide-react";
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
  reviewTeamInvitation,
  sendTeamInvitation,
  manageTeamInvitation,
  type TeamWorkspaceView,
  type TeamInvitationReview,
} from "@/lib/team-billing.functions";
import { validateTeamSelection, teamCheckoutUrl } from "@/lib/team-billing-policy.mjs";
import { teamInvoicePaymentUrl } from "@/lib/team-invitation-policy.mjs";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";

type Team = TeamWorkspaceView["teams"][number];
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
const pill = "min-h-11 rounded-full px-5";
const field = "mt-2 min-h-12 w-full rounded-2xl border border-border bg-background px-4";
export const Route = createFileRoute("/team")({ component: TeamPage });
export function TeamPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="kova-team-page mx-auto min-h-dvh w-full max-w-6xl space-y-8 px-4 py-6 sm:px-8 sm:py-10"
    >
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Your workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">KovaGPT Team</h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            One place for your people, invitations, and shared billing.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm transition-colors hover:bg-muted"
          to="/"
        >
          Back to chat
        </Link>
      </header>
      {!isLoaded ? (
        <p role="status">Loading your account…</p>
      ) : !owner ? (
        <SignInButton mode="modal">
          <Button className={pill}>Sign in to manage your team</Button>
        </SignInButton>
      ) : (
        <TeamWorkspace key={owner} owner={owner} />
      )}
    </main>
  );
}
function TeamWorkspace({ owner }: { owner: string }) {
  const [workspace, setWorkspace] = useState<TeamWorkspaceView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false),
    active = useRef(true);
  const read = useServerFn(getTeamWorkspace),
    portal = useServerFn(createTeamPortal),
    cancel = useServerFn(cancelTeamCheckout),
    mutate = useServerFn(mutateTeamMember),
    manage = useServerFn(manageTeamInvitation);
  async function refresh() {
    const result = await read();
    if (active.current) setWorkspace(result);
  }
  useEffect(() => {
    active.current = true;
    void refresh().catch(() => {
      if (active.current)
        setError("Your team could not be loaded. Refresh to check billing and invitations.");
    });
    return () => {
      active.current = false;
    };
    // Account changes remount the workspace and discard pending presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  async function act(operation: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
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
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5"
        >
          <p className="min-w-0 flex-1 text-sm">{error}</p>
          <Button
            className={pill}
            variant="outline"
            disabled={busy}
            onClick={() => void act(refresh)}
          >
            Refresh workspace
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-2xl border border-border bg-muted/40 px-5 py-4 text-sm">
          {notice}
        </p>
      )}
      {!workspace && !error && (
        <div role="status" className="flex items-center gap-3 rounded-3xl border border-border p-8">
          <Loader2 aria-hidden className="size-5 animate-spin" />
          Checking billing and invitations…
        </div>
      )}
      {workspace?.invitations.map((invite) => (
        <section
          key={invite.id}
          className="flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-border bg-muted/20 p-6"
        >
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              You're invited
            </p>
            <h2 className="text-xl font-semibold">Join {invite.name}</h2>
            <p className="text-sm capitalize text-muted-foreground">
              {invite.seat} seat · Paid by the team owner
            </p>
          </div>
          <Button
            className={pill}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (invite.emailInvitation)
                  await manage({ data: { id: invite.id, action: "accept" } });
                else
                  await mutate({ data: { teamId: invite.id, action: "accept", seat: "standard" } });
                await refresh();
                setNotice("You're now a member of the team.");
              })
            }
          >
            Accept invitation
          </Button>
        </section>
      ))}
      {workspace?.teams.map((team) => {
        const members = team.members.filter((m) => m.state === "active"),
          invitations = team.emailInvitations ?? [],
          paid = team.standard + team.premium,
          enabled = ["active", "trialing"].includes(team.status);
        return (
          <section
            key={team.id}
            className="overflow-hidden rounded-[28px] border border-border bg-card/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-5 border-b border-border p-5 sm:p-7">
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted">
                  <Users aria-hidden className="size-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="break-words text-xl font-semibold tracking-tight">{team.name}</h2>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs ${enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                  >
                    {enabled
                      ? "Active workspace"
                      : team.status === "pending"
                        ? "Finish setup"
                        : team.status.replaceAll("_", " ")}
                  </span>
                </div>
              </div>
              {team.owner && (
                <Button
                  className={pill}
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
                  <CreditCard aria-hidden className="mr-2 size-4" />
                  Manage billing
                  <ArrowUpRight aria-hidden className="ml-2 size-3.5" />
                </Button>
              )}
            </div>
            {team.owner ? (
              <div className="space-y-7 p-5 sm:p-7">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["Members", members.length],
                    ["Paid seats", paid],
                    ["Invitations", invitations.filter((i) => i.state === "invited").length],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-muted/40 p-4 sm:p-5">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
                    </div>
                  ))}
                </div>
                {enabled && (
                  <InviteComposer
                    team={team}
                    busy={busy}
                    act={act}
                    refresh={refresh}
                    onNotice={setNotice}
                    navigate={navigate}
                  />
                )}
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">People</h3>
                    <span className="text-xs text-muted-foreground">
                      {team.standard} Standard · {team.premium} Premium
                    </span>
                  </div>
                  {!team.members.length && !invitations.length ? (
                    <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
                      <Users aria-hidden className="mx-auto mb-3 size-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Your people will appear here after setup.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border rounded-2xl border border-border px-4 sm:px-5">
                      {team.members.map((member) => (
                        <li
                          key={member.user_id}
                          className="flex flex-wrap items-center justify-between gap-4 py-4"
                        >
                          <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                              {member.user_id === owner ? (
                                <Crown aria-hidden className="size-4" />
                              ) : (
                                (member.email || "M").slice(0, 1).toUpperCase()
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="break-all text-sm font-medium">
                                {member.user_id === owner
                                  ? "You · Owner"
                                  : member.email || "Team member"}
                              </p>
                              <p className="mt-1 text-xs capitalize text-muted-foreground">
                                {member.seat} · {member.state}
                              </p>
                            </div>
                          </div>
                          {member.user_id !== owner && (
                            <Button
                              className={pill}
                              variant="ghost"
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
                                  setNotice(
                                    "Member removed. Their paid seat is available for another invitation. Manage billing to reduce purchased seats.",
                                  );
                                })
                              }
                            >
                              Remove
                            </Button>
                          )}
                        </li>
                      ))}
                      {invitations.map((invite) => (
                        <li
                          key={invite.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-4"
                        >
                          <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Mail aria-hidden className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="break-all text-sm font-medium">{invite.email}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                <span className="capitalize">{invite.seat}</span> ·{" "}
                                {invite.state === "draft"
                                  ? "Ready for review"
                                  : invite.state === "billing"
                                    ? "Payment or billing confirmation pending"
                                    : invite.mail_sent_at
                                      ? "Invitation emailed"
                                      : "Email delivery pending"}
                              </p>
                            </div>
                          </div>
                          {invite.state !== "billing" && (
                            <Button
                              className={pill}
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await manage({ data: { id: invite.id, action: "cancel" } });
                                  await refresh();
                                })
                              }
                            >
                              Cancel invitation
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {team.status === "pending" && (
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      Finish payment to invite your team. No seats are active yet.
                    </p>
                    <Button
                      className={pill}
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
                  </div>
                )}
                {enabled && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Invitations use available paid seats first. Adding a seat changes your
                    subscription after you review the charge. Canceling an invitation or removing a
                    member leaves the seat available; use Manage billing to reduce purchased seats.
                  </p>
                )}
              </div>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Your seat is managed and paid for by the team owner.
              </p>
            )}
          </section>
        );
      })}
      {workspace && !ownsTeam && <StartTeam busy={busy} act={act} navigate={navigate} />}
    </div>
  );
}
function InviteComposer({
  team,
  busy,
  act,
  refresh,
  onNotice,
  navigate,
}: {
  team: Team;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onNotice: (message: string) => void;
  navigate: (url: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [seat, setSeat] = useState<"standard" | "premium">("standard"),
    [review, setReview] = useState<TeamInvitationReview | null>(null);
  const quote = useServerFn(reviewTeamInvitation),
    send = useServerFn(sendTeamInvitation),
    manage = useServerFn(manageTeamInvitation);
  async function sendReviewed() {
    if (!review) return;
    const result = await send({ data: { id: review.id } });
    if (result.paymentUrl) {
      const url = teamInvoicePaymentUrl(result.paymentUrl);
      if (!url) throw new Error("Secure payment could not open.");
      navigate(url);
      return;
    }
    await refresh();
    if (result.ready) {
      setEmail("");
      setReview(null);
      onNotice(
        result.emailSent
          ? "Invitation emailed. Your member can sign in or create an account to accept."
          : "Invitation saved. Email delivery is pending; refresh this workspace to retry safely.",
      );
    } else onNotice("The seat payment is still being confirmed. No invitation has been sent yet.");
  }
  return (
    <section
      aria-label="Invite a member"
      className="rounded-3xl border border-border bg-muted/20 p-4 sm:p-6"
    >
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-background">
          <Users aria-hidden className="size-5" />
        </span>
        <div>
          <h3 className="font-semibold">Bring your team together</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Invite by email. They can create an account when they accept.
          </p>
        </div>
      </div>
      {!review ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const result = await quote({ data: { teamId: team.id, email, seat } });
              setReview(result);
              await refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="text-sm font-medium">
              Email address
              <Input
                className={field}
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Seat type
              <select
                className={field}
                value={seat}
                onChange={(e) => setSeat(e.target.value as typeof seat)}
              >
                <option value="standard">Standard</option>
                <option value="premium">Premium · 5× usage</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              We'll show the cost before sending. An available seat adds no extra charge.
            </p>
            <Button className={pill} type="submit" disabled={busy || !email}>
              <Users aria-hidden className="mr-2 size-4" />
              {busy ? "Preparing…" : "Review invitation"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-medium">{email}</p>
              <p className="mt-1 text-sm capitalize text-muted-foreground">{seat} seat</p>
            </div>
            <span className="rounded-full bg-background px-3 py-1.5 text-xs">
              {review.quote.added ? "One additional paid seat" : "Available seat"}
            </span>
          </div>
          <dl className="space-y-3 rounded-2xl bg-background p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Estimated charge today, before tax</dt>
              <dd className="shrink-0 font-medium">{money(review.quote.beforeTax)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Estimated total including tax</dt>
              <dd className="shrink-0">{money(review.quote.total)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-3">
              <dt>Added recurring cost</dt>
              <dd className="shrink-0 font-medium">
                {money(review.quote.recurring)} /{" "}
                {review.quote.interval === "year" ? "year" : "month"}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {review.quote.added
              ? "Sending adds one seat to your existing subscription and bills the prorated amount to your payment method. Additional authentication opens securely in Stripe. Applicable tax is included in the estimate. "
              : "This invitation uses a seat you've already paid for. "}
            The email is sent after billing is confirmed. Only the invited email can accept.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              className={pill}
              variant="outline"
              disabled={busy || review.state === "billing"}
              onClick={() =>
                void act(async () => {
                  await manage({ data: { id: review.id, action: "cancel" } });
                  setReview(null);
                  await refresh();
                })
              }
            >
              Cancel
            </Button>
            <Button
              className={`${pill} w-full whitespace-normal sm:w-auto`}
              disabled={busy}
              onClick={() => void act(sendReviewed)}
            >
              <Mail aria-hidden className="mr-2 size-4" />
              {busy
                ? "Sending…"
                : review.quote.added
                  ? "Send invitation & add seat"
                  : "Send invitation"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
function StartTeam({
  busy,
  act,
  navigate,
}: {
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  navigate: (url: string) => void;
}) {
  const [name, setName] = useState("My team"),
    [standard, setStandard] = useState(2),
    [premium, setPremium] = useState(0),
    [interval, setInterval] = useState<"month" | "year">("month");
  const checkout = useServerFn(createTeamCheckout),
    total =
      standard * (interval === "year" ? 24000 : 2500) +
      premium * (interval === "year" ? 120000 : 12500);
  return (
    <form
      className="space-y-6 rounded-[28px] border border-border p-5 sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          validateTeamSelection({ standard, premium, interval });
          const result = await checkout({ data: { name, standard, premium, interval } });
          navigate(teamCheckoutUrl(result.url));
        });
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-muted">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Start a team</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose your seats. Invite your people after checkout.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Team name
          <Input
            className={field}
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          Billing period
          <select
            aria-label="Billing period"
            className={field}
            value={interval}
            onChange={(e) => setInterval(e.target.value as typeof interval)}
          >
            <option value="month">Monthly</option>
            <option value="year">Annually</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["standard", "premium"] as const).map((kind) => (
          <label key={kind} className="rounded-2xl border border-border bg-muted/20 p-5">
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium capitalize">{kind}</span>
              {kind === "premium" && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">5× usage</span>
              )}
            </span>
            <span className="mt-2 block text-sm text-muted-foreground">
              $
              {kind === "standard"
                ? interval === "year"
                  ? 20
                  : 25
                : interval === "year"
                  ? 100
                  : 125}{" "}
              / seat / month{interval === "year" ? ", billed annually" : ""}
            </span>
            <Input
              aria-label={`${kind === "standard" ? "Standard" : "Premium"} seats`}
              className={field}
              type="number"
              min={0}
              max={150}
              value={kind === "standard" ? standard : premium}
              onChange={(e) =>
                (kind === "standard" ? setStandard : setPremium)(Number(e.target.value))
              }
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-muted/30 p-5">
        <div>
          <p className="text-xs text-muted-foreground">
            {standard + premium} seats · Total before tax
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {money(total)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / {interval === "year" ? "year" : "month"}
            </span>
          </p>
        </div>
        <Button className={pill} type="submit" disabled={busy}>
          {busy ? "Opening…" : "Continue to Team payment"}
          <ArrowUpRight aria-hidden className="ml-2 size-4" />
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Choose 2–150 seats, including your own. Plus applicable tax. Stripe opens full-screen for
        payment. Team billing is separate from any personal subscription.
      </p>
    </form>
  );
}
