import { useEffect, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";

export type SessionPreviewState = {
  revoked: string[];
  pending: string | null;
  result: string | null;
  error: boolean;
};
export type SessionPreviewAction =
  | { type: "request"; id: string }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "fail" }
  | { type: "reset" };
export const SAMPLE_SESSIONS = [
  {
    id: "current",
    label: "This device · sample desktop",
    current: true,
    activity: "Active now · sample",
  },
  {
    id: "phone",
    label: "Sample phone",
    current: false,
    activity: "Last active 2 hours ago · sample",
  },
  {
    id: "tablet",
    label: "Sample tablet",
    current: false,
    activity: "Last active yesterday · sample",
  },
];
export function createSessionPreviewState(): SessionPreviewState {
  return { revoked: [], pending: null, result: null, error: false };
}
export function sessionsPreviewReducer(
  state: SessionPreviewState,
  action: SessionPreviewAction,
): SessionPreviewState {
  if (action.type === "reset") return createSessionPreviewState();
  if (action.type === "request")
    return state.pending === null &&
      SAMPLE_SESSIONS.some((session) => session.id === action.id && !session.current) &&
      !state.revoked.includes(action.id)
      ? { ...state, pending: action.id, result: null, error: false }
      : state;
  if (action.type === "cancel") return { ...state, pending: null, error: false };
  if (!state.pending) return state;
  if (action.type === "fail") return { ...state, error: true };
  return {
    revoked: [...new Set([...state.revoked, state.pending])],
    pending: null,
    result: state.pending,
    error: false,
  };
}

export function SessionsPreview() {
  const [state, dispatch] = useReducer(
    sessionsPreviewReducer,
    undefined,
    createSessionPreviewState,
  );
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resultRef = useRef<HTMLParagraphElement | null>(null);
  const previousPendingRef = useRef<string | null>(null);

  useEffect(() => {
    const previousPending = previousPendingRef.current;
    previousPendingRef.current = state.pending;

    if (state.pending !== null) {
      confirmationHeadingRef.current?.focus();
    } else if (previousPending !== null) {
      // Wait until the confirmation is removed and its trigger is enabled again.
      if (state.result !== null) resultRef.current?.focus();
      else revokeTriggerRef.current?.focus();
    }
  }, [state.pending, state.result]);

  const pending = SAMPLE_SESSIONS.find((session) => session.id === state.pending);
  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby="sessions-preview-title"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Proposal · private review · sample data
        </p>
        <h2 id="sessions-preview-title" className="mt-2 text-2xl font-semibold">
          Device sessions
        </h2>
      </header>
      <p className="rounded-xl border bg-muted/40 p-3 text-sm">
        Per-device session listing and revocation are not available through this preview. These
        devices are invented samples. Local changes here never sign out a device or call
        account-security services.
      </p>
      <ul className="space-y-3" aria-label="Sample device sessions">
        {SAMPLE_SESSIONS.map((session) => (
          <li
            key={session.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          >
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{session.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.revoked.includes(session.id)
                  ? "Revoked · sample state only"
                  : session.activity}
              </p>
            </div>
            {session.current ? (
              <span className="rounded-full bg-muted px-3 py-1 text-xs">Current sample device</span>
            ) : (
              <Button
                variant="outline"
                disabled={state.revoked.includes(session.id) || state.pending !== null}
                onClick={(event) => {
                  revokeTriggerRef.current = event.currentTarget;
                  dispatch({ type: "request", id: session.id });
                }}
              >
                {state.revoked.includes(session.id) ? "Sample revoked" : "Preview revoke"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {pending && (
        <section
          aria-labelledby="revoke-preview-title"
          className="space-y-3 rounded-2xl border p-4"
        >
          <h3
            id="revoke-preview-title"
            ref={confirmationHeadingRef}
            tabIndex={-1}
            className="font-semibold"
          >
            Revoke {pending.label}?
          </h3>
          <p className="text-sm text-muted-foreground">
            A real revocation would require that device to sign in again. Confirming here changes
            only its sample state.
          </p>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              Sample revocation failed. No sample device was changed. Try again or cancel.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => dispatch({ type: "confirm" })}>
              {state.error ? "Retry sample revoke" : "Confirm sample revoke"}
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "fail" })}>
              Simulate revoke failure
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "cancel" })}>
              Cancel sample revoke
            </Button>
          </div>
        </section>
      )}
      {state.result && (
        <p
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="rounded-xl bg-muted/40 p-3 text-sm"
        >
          {SAMPLE_SESSIONS.find((session) => session.id === state.result)?.label} is marked revoked
          in this preview only. Your real sessions are unchanged.
        </p>
      )}
      <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
        Reset sample sessions
      </Button>
    </section>
  );
}
