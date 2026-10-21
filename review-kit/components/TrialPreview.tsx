import { useEffect, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";

export type TrialSampleStage =
  "eligible" | "start" | "active" | "ending" | "expired" | "ineligible" | "cancel" | "canceled";
export type TrialPreviewState = {
  stage: TrialSampleStage;
  returnTo: "active" | "ending";
  reviewed: boolean;
};
export type TrialPreviewAction =
  | { type: "select"; stage: Exclude<TrialSampleStage, "cancel" | "canceled"> }
  | { type: "reviewed"; value: boolean }
  | { type: "start" }
  | { type: "confirmStart" }
  | { type: "cancel" }
  | { type: "confirmCancel" }
  | { type: "return" }
  | { type: "ending" }
  | { type: "expire" }
  | { type: "reset" };
export function createTrialPreviewState(): TrialPreviewState {
  return { stage: "eligible", returnTo: "active", reviewed: false };
}
export function trialPreviewReducer(
  state: TrialPreviewState,
  action: TrialPreviewAction,
): TrialPreviewState {
  switch (action.type) {
    case "reset":
      return createTrialPreviewState();
    case "select":
      return { ...createTrialPreviewState(), stage: action.stage };
    case "reviewed":
      return state.stage === "start" ? { ...state, reviewed: action.value } : state;
    case "start":
      return state.stage === "eligible" ? { ...state, stage: "start", reviewed: false } : state;
    case "confirmStart":
      return state.stage === "start" && state.reviewed ? { ...state, stage: "active" } : state;
    case "cancel":
      return state.stage === "active" || state.stage === "ending"
        ? { ...state, stage: "cancel", returnTo: state.stage }
        : state;
    case "confirmCancel":
      return state.stage === "cancel" ? { ...state, stage: "canceled", reviewed: false } : state;
    case "return":
      return state.stage === "cancel"
        ? { ...state, stage: state.returnTo }
        : state.stage === "start"
          ? createTrialPreviewState()
          : state;
    case "ending":
      return state.stage === "active" ? { ...state, stage: "ending" } : state;
    case "expire":
      return state.stage === "active" || state.stage === "ending"
        ? { ...state, stage: "expired", reviewed: false }
        : state;
  }
}

export function TrialPreview() {
  const [state, dispatch] = useReducer(trialPreviewReducer, undefined, createTrialPreviewState);
  const stateHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const startTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusTargetRef = useRef<"details" | "start" | "cancel" | null>(null);

  const transitionFromButton = (
    action: TrialPreviewAction,
    focusTarget: "details" | "start" | "cancel" = "details",
  ) => {
    focusTargetRef.current = focusTarget;
    dispatch(action);
  };

  useEffect(() => {
    const target = focusTargetRef.current;
    focusTargetRef.current = null;
    if (target === null) return;
    const element =
      target === "start"
        ? startTriggerRef.current
        : target === "cancel"
          ? cancelTriggerRef.current
          : stateHeadingRef.current;
    (element ?? stateHeadingRef.current)?.focus();
  }, [state.stage]);

  const labels = {
    eligible: "Eligible",
    start: "Start",
    active: "Active",
    ending: "Ending",
    expired: "Expired",
    ineligible: "Ineligible",
  } as const;
  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby="trial-preview-title"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Proposal · private review · sample data
        </p>
        <h2 id="trial-preview-title" className="mt-2 text-2xl font-semibold">
          Trial lifecycle preview
        </h2>
      </header>
      <p className="rounded-xl border bg-muted/40 p-3 text-sm">
        These are sample trial states, not an actual offer or eligibility decision. No trial starts,
        charge occurs, payment details are collected, or account entitlement changes in this
        preview.
      </p>
      <section className="rounded-xl border p-3" aria-labelledby="trial-decisions-title">
        <h3 id="trial-decisions-title" className="text-sm font-semibold">
          Owner decision required
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Eligibility rules, applicable plan, duration, price, charge date, cancellation effects and
          included access require confirmed commercial and provider decisions. This proposal does
          not assign those facts or accept terms.
        </p>
      </section>
      <label className="block text-sm font-medium">
        Sample trial state
        <select
          className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
          value={state.stage}
          onChange={(event) =>
            dispatch({ type: "select", stage: event.target.value as keyof typeof labels })
          }
        >
          {(state.stage === "cancel" || state.stage === "canceled") && (
            <option value={state.stage} disabled>
              {state.stage === "cancel" ? "Confirm cancellation · sample" : "Canceled · sample"}
            </option>
          )}
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label} · sample
            </option>
          ))}
        </select>
      </label>
      <section
        className="space-y-3 rounded-2xl border bg-card/40 p-4 sm:p-5"
        aria-label="Sample trial details"
      >
        <h3 ref={stateHeadingRef} tabIndex={-1} className="font-semibold">
          {state.stage === "cancel"
            ? "Confirm sample cancellation"
            : state.stage === "canceled"
              ? "Canceled · sample state"
              : `${labels[state.stage]} · sample state`}
        </h3>
        {state.stage === "eligible" && (
          <>
            <p className="text-sm">
              This scenario assumes sample eligibility only. A real eligibility check is unavailable
              here.
            </p>
            <Button ref={startTriggerRef} onClick={() => transitionFromButton({ type: "start" })}>
              Preview trial start
            </Button>
          </>
        )}
        {state.stage === "start" && (
          <>
            <p className="text-sm">
              Review the missing commercial decisions above before simulating an active trial. This
              is not checkout or acceptance of an offer.
            </p>
            <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={state.reviewed}
                onChange={(event) => dispatch({ type: "reviewed", value: event.target.checked })}
              />
              <span>I understand this changes sample state only and grants no real access.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!state.reviewed}
                onClick={() => transitionFromButton({ type: "confirmStart" })}
              >
                Simulate trial start
              </Button>
              <Button
                variant="outline"
                onClick={() => transitionFromButton({ type: "return" }, "start")}
              >
                Cancel start preview
              </Button>
            </div>
          </>
        )}
        {(state.stage === "active" || state.stage === "ending") && (
          <>
            <p role="status" className="text-sm">
              {state.stage === "active"
                ? "The sample trial is active. This does not describe your account or grant a paid plan."
                : "The sample trial is ending. No end date, renewal charge or continued access is promised."}
            </p>
            <div className="flex flex-wrap gap-2">
              {state.stage === "active" && (
                <Button variant="outline" onClick={() => transitionFromButton({ type: "ending" })}>
                  Simulate ending state
                </Button>
              )}
              <Button variant="outline" onClick={() => transitionFromButton({ type: "expire" })}>
                Simulate expiry
              </Button>
              <Button
                ref={cancelTriggerRef}
                variant="outline"
                onClick={() => transitionFromButton({ type: "cancel" })}
              >
                Preview cancellation
              </Button>
            </div>
          </>
        )}
        {state.stage === "cancel" && (
          <>
            <p className="text-sm">
              Confirming marks this sample trial canceled only. Real billing and access consequences
              require an approved policy and provider contract.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={() => transitionFromButton({ type: "confirmCancel" })}
              >
                Confirm sample cancellation
              </Button>
              <Button
                variant="outline"
                onClick={() => transitionFromButton({ type: "return" }, "cancel")}
              >
                Return without canceling
              </Button>
            </div>
          </>
        )}
        {state.stage === "canceled" && (
          <p role="status" className="text-sm">
            Sample cancellation complete. No real subscription, trial, charge or account access
            changed.
          </p>
        )}
        {state.stage === "expired" && (
          <p role="status" className="text-sm">
            This sample trial has expired. Further access and billing behavior are unspecified
            pending owner/provider decisions.
          </p>
        )}
        {state.stage === "ineligible" && (
          <p role="status" className="text-sm">
            This scenario assumes the sample account is ineligible. No actual account was checked,
            and no reason is invented. Trial start is unavailable in this state.
          </p>
        )}
      </section>
      <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
        Reset trial preview
      </Button>
    </section>
  );
}
