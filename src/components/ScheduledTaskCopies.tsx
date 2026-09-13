import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listScheduledTaskOffers,
  decideScheduledTaskCopy,
  type ScheduledTask,
} from "@/lib/scheduled-tasks.functions";
type Offer = {
  id: string;
  source_task_id: string;
  title: string;
  prompt: string;
  repeat: string;
  timezone: string;
  expires_at: string;
};
type ScheduledTaskCopiesProps = {
  tasks: ScheduledTask[];
  userKey: string;
  eligible: boolean;
  onChanged: () => void;
};
export function ScheduledTaskCopies(props: ScheduledTaskCopiesProps) {
  return <ScheduledTaskCopiesBody key={props.userKey} {...props} />;
}
function ScheduledTaskCopiesBody({
  tasks,
  userKey,
  eligible,
  onChanged,
}: ScheduledTaskCopiesProps) {
  const list = useServerFn(listScheduledTaskOffers),
    decide = useServerFn(decideScheduledTaskCopy);
  const [offers, setOffers] = useState<{ sent: Offer[]; received: Offer[] }>({
      sent: [],
      received: [],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(true),
    ids = useRef(new Map<string, string>()),
    locked = useRef(false);
  useEffect(() => {
    active.current = true;
    let canceled = false;
    list({ data: { expectedUserId: userKey } })
      .then((value) => {
        if (!canceled && active.current) setOffers(value as { sent: Offer[]; received: Offer[] });
      })
      .catch(() => {
        if (!canceled && active.current) setError("Task copy offers could not be loaded.");
      });
    return () => {
      canceled = true;
      active.current = false;
    };
  }, [list, userKey, tasks]);
  function id(key: string) {
    let value = ids.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      ids.current.set(key, value);
    }
    return value;
  }
  async function action(offer: Offer, decision: "accept" | "decline" | "revoke") {
    if (locked.current) return;
    const task = tasks.find((item) => item.id === offer.source_task_id);
    if (decision === "revoke" && !task) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await decide({
        data: {
          expectedUserId: userKey,
          id: decision === "revoke" ? offer.source_task_id : id(offer.id + ":copy"),
          mutationId: id(offer.id + ":" + decision),
          expectedRevision: decision === "revoke" ? task!.revision : 0,
          offerId: offer.id,
          decision,
        },
      });
      if (active.current) {
        setOffers((current) => ({
          sent: current.sent.filter((item) => item.id !== offer.id),
          received: current.received.filter((item) => item.id !== offer.id),
        }));
        onChanged();
      }
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "This decision could not be confirmed. Retry the same action.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (!error && !offers.received.length && !offers.sent.length) return null;
  return (
    <section
      className="my-5 space-y-3 rounded-xl border border-border p-4"
      aria-label="Shared task copies"
    >
      <h2 className="font-medium">Task copy offers</h2>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {offers.received.map((offer) => (
        <article key={offer.id} className="rounded-lg border border-border p-3 text-sm">
          <strong>{offer.title}</strong>
          <p className="my-2 whitespace-pre-wrap">{offer.prompt}</p>
          <p>
            {offer.repeat} · {offer.timezone} · expires{" "}
            {new Date(offer.expires_at).toLocaleDateString()}
          </p>
          <p className="my-2 text-xs">
            Accepting creates your own paused task. You choose its schedule and authorize your own
            context and connections before running it.
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy || !eligible}
              onClick={() => void action(offer, "accept")}
              className="rounded border px-3 py-2 disabled:opacity-50"
            >
              Accept paused copy
            </button>
            <button
              disabled={busy}
              onClick={() => void action(offer, "decline")}
              className="rounded border px-3 py-2"
            >
              Decline
            </button>
          </div>
        </article>
      ))}
      {offers.sent.map((offer) => (
        <article key={offer.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{offer.title} · awaiting recipient acceptance</span>
          <button
            disabled={busy || !tasks.some((task) => task.id === offer.source_task_id)}
            onClick={() => void action(offer, "revoke")}
            className="rounded border px-3 py-2"
          >
            Revoke offer
          </button>
        </article>
      ))}
    </section>
  );
}
