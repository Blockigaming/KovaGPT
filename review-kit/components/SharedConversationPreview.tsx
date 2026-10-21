import { useLayoutEffect, useReducer, useRef } from "react";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Button } from "@/components/ui/button";

export type SharedPreviewMode = "available" | "private" | "deleted" | "unavailable";
export type SharedPreviewState = { mode: SharedPreviewMode; copy: "idle" | "previewed" | "failed" };
export type SharedPreviewAction =
  | { type: "mode"; mode: SharedPreviewMode }
  | { type: "copy" }
  | { type: "copyFailure" }
  | { type: "reset" };
export function sharedPreviewReducer(
  state: SharedPreviewState,
  action: SharedPreviewAction,
): SharedPreviewState {
  if (action.type === "reset") return { mode: "available", copy: "idle" };
  if (action.type === "mode") return { mode: action.mode, copy: "idle" };
  if (state.mode !== "available") return state;
  return { ...state, copy: action.type === "copy" ? "previewed" : "failed" };
}
const sampleConversation =
  "Sample user: How should I review a release?\n\nSample assistant: Check the draft, verify the important interactions, and record unresolved issues before approving release.";

export function SharedConversationPreview() {
  const [state, dispatch] = useReducer(sharedPreviewReducer, { mode: "available", copy: "idle" });
  const viewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryFocusRef = useRef<{ trigger: HTMLButtonElement; url: string } | null>(null);
  useLayoutEffect(() => {
    const origin = retryFocusRef.current;
    retryFocusRef.current = null;
    if (!origin || state.mode !== "available") return;
    const active = document.activeElement;
    restoreDialogFocus(
      viewerHeadingRef.current,
      origin.url,
      active !== null && active !== document.body && active !== origin.trigger,
    );
  }, [state.mode]);
  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby="shared-preview-title"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Proposal · private review · sample data
        </p>
        <h2 id="shared-preview-title" className="mt-2 text-2xl font-semibold">
          Shared conversation viewer
        </h2>
      </header>
      <p className="rounded-xl border bg-muted/40 p-3 text-sm">
        Public shared-link viewing is unavailable in the current product. This proposal shows local
        sample states only. It creates no link and exposes no conversation or account data.
      </p>
      <div role="group" aria-label="Sample viewer state" className="flex flex-wrap gap-2">
        {(["available", "private", "deleted", "unavailable"] as const).map((mode) => (
          <Button
            key={mode}
            variant={state.mode === mode ? "secondary" : "outline"}
            aria-pressed={state.mode === mode}
            onClick={() => dispatch({ type: "mode", mode })}
          >
            {mode[0].toUpperCase() + mode.slice(1)}
          </Button>
        ))}
      </div>
      {state.mode === "available" ? (
        <article className="space-y-4 rounded-2xl border bg-card/40 p-4 sm:p-6">
          <header>
            <h3 ref={viewerHeadingRef} tabIndex={-1} className="text-lg font-semibold">
              Release review checklist · sample
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only proposal · no real sharing enabled
            </p>
          </header>
          <div className="rounded-xl bg-muted/50 p-4">
            <h4 className="text-sm font-semibold">Sample user</h4>
            <p className="mt-2 text-sm">How should I review a release?</p>
          </div>
          <div className="rounded-xl border p-4">
            <h4 className="text-sm font-semibold">Sample assistant</h4>
            <p className="mt-2 text-sm">
              Check the draft, verify the important interactions, and record unresolved issues
              before approving release.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: "copy" })}>
              Preview copy feedback
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "copyFailure" })}>
              Simulate copy failure
            </Button>
          </div>
          {state.copy !== "idle" && (
            <div className="space-y-2">
              <p role={state.copy === "failed" ? "alert" : "status"} className="text-sm">
                {state.copy === "failed"
                  ? "Sample copy failed. Select the text below to copy it yourself."
                  : "Sample copy feedback shown. This preview does not write to your clipboard; select the text below if needed."}
              </p>
              <textarea
                aria-label="Sample conversation text for manual copy"
                readOnly
                value={sampleConversation}
                className="min-h-32 w-full min-w-0 rounded-xl border bg-background p-3 text-sm"
              />
            </div>
          )}
        </article>
      ) : (
        <div
          role={state.mode === "unavailable" ? "alert" : "status"}
          className="rounded-2xl border p-5"
        >
          <h3 className="font-semibold">
            {state.mode === "private"
              ? "This sample conversation is private"
              : state.mode === "deleted"
                ? "This sample conversation was deleted"
                : "This sample conversation is unavailable"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.mode === "private"
              ? "A real viewer would need an authorized access path. No sign-in or permission request is available in this proposal."
              : state.mode === "deleted"
                ? "No messages are displayed in this sample state. Reset the preview to view the sample conversation again."
                : "A real service could not be reached in this proposed state. The button below simulates a successful retry only."}
          </p>
          {state.mode === "unavailable" && (
            <Button
              className="mt-4"
              variant="outline"
              onClick={(event) => {
                retryFocusRef.current = {
                  trigger: event.currentTarget,
                  url: window.location.href,
                };
                dispatch({ type: "mode", mode: "available" });
              }}
            >
              Simulate successful retry
            </Button>
          )}
        </div>
      )}
      <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
        Reset shared-viewer preview
      </Button>
    </section>
  );
}
