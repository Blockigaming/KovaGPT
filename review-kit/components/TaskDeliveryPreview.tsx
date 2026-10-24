import { useEffect, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { taskTimezone } from "@/lib/scheduled-task-policy.mjs";

export type DeliveryDraft = { inApp: boolean; email: boolean; timezone: string };
export type DeliveryPreviewState = {
  draft: DeliveryDraft;
  saved: DeliveryDraft | null;
  stage: "editing" | "review" | "saved";
  error: string;
  status: string;
};
export type DeliveryPreviewAction =
  | { type: "edit"; patch: Partial<DeliveryDraft> }
  | { type: "review" }
  | { type: "save" }
  | { type: "fail" }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "reset" };
export function createDeliveryPreviewState(): DeliveryPreviewState {
  return {
    draft: { inApp: true, email: false, timezone: "UTC" },
    saved: null,
    stage: "editing",
    error: "",
    status: "",
  };
}
export function validateDeliveryDraft(draft: DeliveryDraft): string {
  if (!draft.inApp && !draft.email) return "Choose at least one sample delivery channel.";
  try {
    taskTimezone(draft.timezone.trim());
  } catch {
    return "Enter a valid IANA time zone, such as Europe/London or UTC.";
  }
  return "";
}
export function taskDeliveryPreviewReducer(
  state: DeliveryPreviewState,
  action: DeliveryPreviewAction,
): DeliveryPreviewState {
  if (action.type === "reset") return createDeliveryPreviewState();
  if (action.type === "edit")
    return {
      ...state,
      draft: { ...state.draft, ...action.patch },
      stage: "editing",
      error: "",
      status: "",
    };
  if (action.type === "cancel")
    return {
      ...state,
      draft: { ...(state.saved ?? createDeliveryPreviewState().draft) },
      stage: "editing",
      error: "",
      status: "Unsaved sample changes canceled.",
    };
  if (action.type === "back") return { ...state, stage: "editing", error: "", status: "" };
  if (action.type === "review") {
    const error = validateDeliveryDraft(state.draft);
    return error
      ? { ...state, stage: "editing", error, status: "" }
      : {
          ...state,
          draft: { ...state.draft, timezone: state.draft.timezone.trim() },
          stage: "review",
          error: "",
          status: "",
        };
  }
  if (state.stage !== "review") return state;
  if (action.type === "fail")
    return {
      ...state,
      stage: "editing",
      error: "Sample save failed. Your draft is still here; review it to try again.",
      status: "",
    };
  return {
    ...state,
    saved: { ...state.draft },
    stage: "saved",
    error: "",
    status: "Sample preferences saved in this preview only. No notification was scheduled or sent.",
  };
}

export function TaskDeliveryPreview() {
  const [state, dispatch] = useReducer(
    taskDeliveryPreviewReducer,
    undefined,
    createDeliveryPreviewState,
  );
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const previousStageRef = useRef<DeliveryPreviewState["stage"]>("editing");

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = state.stage;

    if (state.stage === "review") {
      (reviewHeadingRef.current ?? headingRef.current)?.focus();
    } else if (previousStage === "review") {
      const target =
        state.stage === "saved"
          ? statusRef.current
          : state.error
            ? errorRef.current
            : reviewTriggerRef.current;
      (target ?? headingRef.current)?.focus();
    }
  }, [state.stage, state.error]);

  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby="delivery-preview-title"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Proposal · private review · sample data
        </p>
        <h2
          id="delivery-preview-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-2xl font-semibold"
        >
          Task delivery preferences
        </h2>
      </header>
      <p className="rounded-xl border bg-muted/40 p-3 text-sm">
        Delivery preferences have no supported backend contract here. This local proposal cannot
        send email, create notifications, or change scheduled tasks. The owner and provider must
        decide supported channels, destination verification, consent and delivery behavior before
        implementation.
      </p>
      {state.stage !== "review" && (
        <fieldset className="space-y-3 rounded-2xl border p-4">
          <legend className="px-1 text-sm font-semibold">Proposed delivery channels</legend>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={state.draft.inApp}
              onChange={(event) =>
                dispatch({ type: "edit", patch: { inApp: event.target.checked } })
              }
            />
            <span>In-app notification · proposed sample channel</span>
          </label>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={state.draft.email}
              onChange={(event) =>
                dispatch({ type: "edit", patch: { email: event.target.checked } })
              }
            />
            <span>Email · proposed sample channel</span>
          </label>
          {state.draft.email && (
            <p className="rounded-xl bg-muted/40 p-3 text-sm">
              Sample destination: preview@example.invalid. This is not your address. No email will
              be sent.
            </p>
          )}
          <label className="block text-sm font-medium">
            Delivery time zone
            <input
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm"
              value={state.draft.timezone}
              maxLength={100}
              onChange={(event) =>
                dispatch({ type: "edit", patch: { timezone: event.target.value } })
              }
              placeholder="Europe/London"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            IANA validation matches the existing task time-zone rules. This proposal does not change
            a task's run time or promise a delivery time.
          </p>
        </fieldset>
      )}
      {state.stage === "review" && (
        <section
          className="space-y-3 rounded-2xl border p-4"
          aria-labelledby="delivery-review-title"
        >
          <h3
            id="delivery-review-title"
            ref={reviewHeadingRef}
            tabIndex={-1}
            className="font-semibold"
          >
            Review sample destinations
          </h3>
          <ul className="space-y-2 text-sm">
            {state.draft.inApp && <li>In-app: sample notification inbox only</li>}
            {state.draft.email && <li>Email: preview@example.invalid · sample address only</li>}
            <li>Time zone: {state.draft.timezone}</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Confirming stores this selection in local component memory only. No provider terms or
            delivery guarantees are implied.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => dispatch({ type: "save" })}>Save sample preferences</Button>
            <Button variant="outline" onClick={() => dispatch({ type: "fail" })}>
              Simulate save failure
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "back" })}>
              Back to draft
            </Button>
          </div>
        </section>
      )}
      {state.error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.status && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          className="rounded-xl bg-muted/40 p-3 text-sm"
        >
          {state.status}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {state.stage !== "review" && (
          <Button ref={reviewTriggerRef} onClick={() => dispatch({ type: "review" })}>
            Review sample preferences
          </Button>
        )}
        <Button variant="outline" onClick={() => dispatch({ type: "cancel" })}>
          Cancel draft changes
        </Button>
        <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
          Reset delivery preview
        </Button>
      </div>
    </section>
  );
}
