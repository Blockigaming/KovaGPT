import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";

export const VERIFICATION_SAMPLE_STATUSES = [
  "sent",
  "pending",
  "verified",
  "expired",
  "failed",
] as const;
export type VerificationStatus = (typeof VERIFICATION_SAMPLE_STATUSES)[number];
export type VerificationPreviewState = {
  status: VerificationStatus;
  screen: "verification" | "sign-in";
  cooldown: number;
  notice: string;
  error: string;
};
export function createVerificationPreviewState(): VerificationPreviewState {
  return { status: "sent", screen: "verification", cooldown: 0, notice: "", error: "" };
}
export type VerificationPreviewAction =
  | { type: "select"; status: VerificationStatus }
  | { type: "resend"; outcome: "success" | "failure" }
  | { type: "tick" }
  | { type: "sign-in" }
  | { type: "reset" };
export function verificationPreviewReducer(
  state: VerificationPreviewState,
  action: VerificationPreviewAction,
): VerificationPreviewState {
  switch (action.type) {
    case "select":
      return VERIFICATION_SAMPLE_STATUSES.includes(action.status)
        ? { ...createVerificationPreviewState(), status: action.status }
        : state;
    case "resend":
      if (state.screen !== "verification" || state.status === "verified" || state.cooldown > 0)
        return state;
      return action.outcome === "success"
        ? {
            ...state,
            status: "sent",
            cooldown: 60,
            error: "",
            notice: "Sample resend succeeded. No email was sent.",
          }
        : {
            ...state,
            notice: "",
            error: "Sample resend failed. Try the success outcome to retry locally.",
          };
    case "tick":
      return state.cooldown > 0 ? { ...state, cooldown: state.cooldown - 1 } : state;
    case "sign-in":
      return { ...state, screen: "sign-in", cooldown: 0, notice: "", error: "" };
    case "reset":
      return createVerificationPreviewState();
  }
}
export const VERIFICATION_SAMPLE_COPY: Record<VerificationStatus, { title: string; body: string }> =
  {
    sent: {
      title: "Sample verification email sent",
      body: "A verification message would be sent to preview@example.invalid. No message was sent in this preview.",
    },
    pending: {
      title: "Sample verification pending",
      body: "This sample account is waiting for email verification. This preview does not check an inbox or poll account status.",
    },
    verified: {
      title: "Sample email verified",
      body: "The illustrative verification is complete. No real account has been verified or signed in.",
    },
    expired: {
      title: "Sample verification link expired",
      body: "This illustrative link can no longer be used. Try the sample resend action. No expiry duration or token policy is specified here.",
    },
    failed: {
      title: "Sample verification could not be completed",
      body: "This sample represents an unsuccessful verification. Try a sample resend or return to the illustrative sign-in step.",
    },
  };

export function VerificationPreview() {
  const [state, dispatch] = useReducer(
    verificationPreviewReducer,
    undefined,
    createVerificationPreviewState,
  );
  useEffect(() => {
    if (state.cooldown <= 0) return;
    const timer = setTimeout(() => dispatch({ type: "tick" }), 1000);
    return () => clearTimeout(timer);
  }, [state.cooldown]);
  const copy = VERIFICATION_SAMPLE_COPY[state.status];
  const resendDisabled = state.cooldown > 0 || state.status === "verified";
  return (
    <section
      className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6"
      aria-labelledby="verification-preview-title"
    >
      <header className="space-y-2">
        <h2 id="verification-preview-title" className="text-xl font-semibold">
          Email verification · sample proposal
        </h2>
        <p className="text-sm text-muted-foreground">
          Review-only interface. All changes are local and reset when this preview closes. No email,
          credentials, tokens or account changes are involved.
        </p>
      </header>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Inspect a sample state</legend>
        <div className="flex flex-wrap gap-2">
          {VERIFICATION_SAMPLE_STATUSES.map((status) => (
            <Button
              key={status}
              variant={
                state.status === status && state.screen === "verification" ? "default" : "outline"
              }
              aria-pressed={state.status === status && state.screen === "verification"}
              onClick={() => dispatch({ type: "select", status })}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>
      </fieldset>
      {state.screen === "sign-in" ? (
        <section
          className="space-y-3 rounded-2xl border p-4"
          aria-label="Illustrative sign-in destination"
        >
          <h3 className="font-semibold">Return to sign-in · sample destination</h3>
          <p className="text-sm text-muted-foreground">
            The real flow would return to sign-in. This preview stays here and does not open an
            authentication session.
          </p>
          <Button variant="outline" onClick={() => dispatch({ type: "reset" })}>
            Back to verification preview
          </Button>
        </section>
      ) : (
        <section
          className="space-y-4 rounded-2xl border p-4"
          aria-label="Sample verification status"
        >
          <div role="status" className="space-y-2">
            <h3 className="font-semibold">{copy.title}</h3>
            <p className="break-words text-sm text-muted-foreground">{copy.body}</p>
          </div>
          {state.status !== "verified" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={resendDisabled}
                  onClick={() => dispatch({ type: "resend", outcome: "success" })}
                >
                  {state.cooldown > 0
                    ? `Sample resend available in ${state.cooldown}s`
                    : "Simulate resend success"}
                </Button>
                <Button
                  variant="outline"
                  disabled={resendDisabled}
                  onClick={() => dispatch({ type: "resend", outcome: "failure" })}
                >
                  Simulate resend failure
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The sample 60-second cooldown mirrors the existing sign-in resend control. It does
                not establish link expiry or delivery policy. Selecting a sample state resets the
                demonstration.
              </p>
            </>
          )}
          <Button variant="outline" onClick={() => dispatch({ type: "sign-in" })}>
            Return to sign-in · illustrative
          </Button>
        </section>
      )}
      {state.notice && (
        <p role="status" className="text-sm">
          {state.notice}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
        Reset verification preview
      </Button>
    </section>
  );
}
