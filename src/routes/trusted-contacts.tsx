import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { supabase } from "@/integrations/supabase/client";
import { TRUSTED_CONTACT_POLICY_VERSION } from "@/lib/trusted-contact-policy.mjs";

type Contact = {
  id: string;
  inviter_id: string;
  recipient_id: string;
  inviter_email: string;
  recipient_email: string;
  state: string;
  revision: number;
  expires_at: string;
};
type Block = { id: string; blocked_user_id: string; blocked_email: string; revision: number };
type Snapshot = {
  enabled: boolean;
  active: Contact[];
  history: Contact[];
  blocked: Block[];
  blockPage: number;
  moreBlocked: boolean;
};
export const Route = createFileRoute("/trusted-contacts")({
  component: Page,
  head: () => ({
    meta: [{ title: "Trusted contacts | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
function Page() {
  const { isLoaded, isSignedIn, user } = useUser();
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Trusted contacts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A voluntary connection between two verified accounts. Contacts do not gain access to
          chats, location, account controls, or Family settings. KovaGPT does not monitor for
          crises, send automatic safety alerts, or provide emergency response.
        </p>
        {!isLoaded ? (
          <p className="mt-5" role="status">
            Loading account…
          </p>
        ) : !isSignedIn || !user?.id ? (
          <p className="mt-5">Sign in to manage trusted contacts.</p>
        ) : (
          <Contacts key={user.id} userId={user.id} />
        )}
      </main>
    </AppShell>
  );
}
function Contacts({ userId }: { userId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""),
    [inviteConsent, setInviteConsent] = useState(false),
    [acceptConsent, setAcceptConsent] = useState(false);
  const [review, setReview] = useState<{ id: string; revision: number; token: string } | null>(
    null,
  );
  const epoch = useRef(0),
    mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  const inviteId = useRef<string | null>(null);
  const transport = useCallback(
    async (method: string, body?: unknown, blockPage = 0) => {
      const ticket = ++epoch.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const { data } = await supabase.auth.getSession();
      if (!mounted.current || epoch.current !== ticket || abort.signal.aborted) return null;
      if (data.session?.user.id !== userId || !data.session.access_token)
        throw new Error("Sign in again to manage contacts.");
      try {
        const response = await fetch(
          `/api/trusted-contacts${method === "GET" ? `?blockPage=${blockPage}` : ""}`,
          {
            method,
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${data.session.access_token}`,
              "Content-Type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          },
        );
        const result = await response.json();
        if (!mounted.current || epoch.current !== ticket) return null;
        if (!response.ok) throw new Error(result.error ?? "Contacts could not be updated.");
        return result;
      } catch (reason) {
        if (!mounted.current || epoch.current !== ticket || abort.signal.aborted) return null;
        throw reason;
      }
    },
    [userId],
  );
  const refresh = useCallback(
    async (blockPage = 0) => {
      const result = await transport("GET", undefined, blockPage);
      if (!result) return;
      setSnapshot(result);
      setReview((current) =>
        current &&
        result.active.some(
          (row: Contact) => row.id === current.id && row.revision === current.revision,
        )
          ? current
          : null,
      );
    },
    [transport],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((reason) => {
      if (mounted.current) setError(reason.message);
    });
    const clear = () => {
      epoch.current++;
      controller.current?.abort();
      setReview(null);
      setAcceptConsent(false);
      setSnapshot(null);
      setError(null);
      setMessage(null);
    };
    const focus = () => {
      void refresh().catch((reason) => {
        if (mounted.current) setError(reason.message);
      });
    };
    window.addEventListener("blur", clear);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.removeEventListener("blur", clear);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  async function run(command: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await transport("POST", command);
      if (!result) return;
      if (command.action === "review") {
        setReview({
          id: String(command.id),
          revision: result.result.revision,
          token: result.token,
        });
        setAcceptConsent(false);
      } else {
        setReview(null);
        setAcceptConsent(false);
        setMessage(
          command.action === "invite"
            ? "Invitation created in their in-app contact list. No email was sent."
            : "Contact preference updated.",
        );
      }
      if (command.action === "invite") {
        inviteId.current = null;
        setEmail("");
        setInviteConsent(false);
      }
      await refresh(snapshot?.blockPage ?? 0);
    } catch (reason) {
      if (mounted.current) {
        setReview(null);
        setError(
          reason instanceof Error
            ? reason.message
            : "Contact action failed. Refresh before retrying.",
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const act = (contact: Contact, action: string) =>
    run({ action, id: contact.id, revision: contact.revision, commandId: crypto.randomUUID() });
  const other = (contact: Contact) =>
    contact.inviter_id === userId ? contact.recipient_email : contact.inviter_email;
  return (
    <div className="mt-6 space-y-5">
      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border p-3 text-sm">
          {message}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError(null);
          void refresh(snapshot?.blockPage ?? 0).catch((reason) => setError(reason.message));
        }}
        className="rounded-lg border px-3 py-2 text-sm"
      >
        Refresh contacts
      </button>
      {!snapshot ? (
        <p role="status" className="text-sm text-muted-foreground">
          Contacts have not loaded yet.
        </p>
      ) : (
        <>
          {!snapshot.enabled && (
            <p role="note" className="rounded-xl border p-4 text-sm">
              New connections are not activated. Existing invitations and connections can still be
              declined, revoked, blocked, or removed.
            </p>
          )}
          <section className="rounded-xl border p-4">
            <h2 className="font-semibold">Invite an existing verified account</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              They must review and consent in their own account. Invitations expire after seven
              days.
            </p>
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                inviteId.current ??= crypto.randomUUID();
                void run({
                  action: "invite",
                  id: inviteId.current,
                  recipientEmail: email,
                  consent: inviteConsent,
                  policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
                });
              }}
            >
              <label className="block text-sm">
                Their account email
                <input
                  type="email"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => {
                    inviteId.current = null;
                    setEmail(event.target.value);
                  }}
                  disabled={busy || !snapshot.enabled}
                  className="mt-1 block w-full rounded-lg border bg-background p-2"
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={inviteConsent}
                  onChange={(event) => setInviteConsent(event.target.checked)}
                  disabled={busy || !snapshot.enabled}
                  className="mt-1"
                />
                I agree to share my verified account email with this person and invite them to a
                voluntary contact connection.
              </label>
              <button
                type="submit"
                disabled={busy || !snapshot.enabled || !inviteConsent}
                className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              >
                Create in-app invitation
              </button>
            </form>
          </section>
          <section className="rounded-xl border p-4">
            <h2 className="font-semibold">Connections and invitations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Emails shown here were verified when the invitation was created. No email delivery is
              enabled.
            </p>
            {snapshot.active.length ? (
              <ul className="mt-3 space-y-3">
                {snapshot.active.map((contact) => (
                  <li key={contact.id} className="rounded-lg border p-3">
                    <p className="break-all text-sm font-medium">{other(contact)}</p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      {contact.state}
                      {contact.state === "pending"
                        ? ` · ${contact.inviter_id === userId ? "Sent" : "Received"} · expires ${new Date(contact.expires_at).toLocaleDateString()}`
                        : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {contact.state === "pending" && contact.recipient_id === userId ? (
                        <>
                          <button
                            disabled={busy || !snapshot.enabled}
                            onClick={() => void act(contact, "review")}
                            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                          >
                            Review invitation
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void act(contact, "decline")}
                            className="rounded-lg border px-3 py-2 text-sm"
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => void act(contact, "revoke")}
                          className="rounded-lg border px-3 py-2 text-sm"
                        >
                          Revoke connection
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => void act(contact, "block")}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        Block future invitations
                      </button>
                    </div>
                    {review?.id === contact.id && (
                      <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
                        <p className="text-sm">
                          This connection does not authorize monitoring, automatic alerts, or
                          account access. Acceptance is optional. This review expires in ten
                          minutes.
                        </p>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={acceptConsent}
                            onChange={(event) => setAcceptConsent(event.target.checked)}
                            className="mt-1"
                          />
                          I consent to this voluntary connection and sharing my verified account
                          email. I can revoke it at any time.
                        </label>
                        <button
                          disabled={busy || !acceptConsent || !snapshot.enabled}
                          onClick={() =>
                            void run({
                              action: "accept",
                              id: review.id,
                              revision: review.revision,
                              token: review.token,
                              commandId: crypto.randomUUID(),
                              consent: acceptConsent,
                              policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
                            })
                          }
                          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                        >
                          Accept connection
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No current connections or invitations.
              </p>
            )}
          </section>
          <section className="rounded-xl border p-4">
            <h2 className="font-semibold">Recent finished invitations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 50 recent records. Removing a finished record removes it for both parties.
            </p>
            <ul className="mt-3 space-y-2">
              {snapshot.history.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="break-all">
                    {other(contact)} · {contact.state}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => void act(contact, "remove")}
                    className="rounded-lg border px-3 py-2"
                  >
                    Remove record
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border p-4">
            <h2 className="font-semibold">Accounts you blocked</h2>
            <ul className="mt-3 space-y-2">
              {snapshot.blocked.map((block) => (
                <li
                  key={block.blocked_user_id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="break-all">{block.blocked_email}</span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        action: "unblock",
                        otherId: block.blocked_user_id,
                        blockId: block.id,
                        revision: block.revision,
                      })
                    }
                    className="rounded-lg border px-3 py-2"
                  >
                    Unblock invitations
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-3 text-sm">
              <button
                disabled={busy || snapshot.blockPage === 0}
                onClick={() =>
                  void refresh(snapshot.blockPage - 1).catch((reason) => setError(reason.message))
                }
              >
                Previous
              </button>
              <span>Page {snapshot.blockPage + 1}</span>
              <button
                disabled={busy || !snapshot.moreBlocked}
                onClick={() =>
                  void refresh(snapshot.blockPage + 1).catch((reason) => setError(reason.message))
                }
              >
                Next
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
