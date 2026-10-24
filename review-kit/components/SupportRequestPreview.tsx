import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const SUPPORT_CATEGORIES = [
  "Account access",
  "Billing",
  "Report a problem",
  "Other",
] as const;
const MIB = 1024 * 1024;
export type SupportAttachment = Pick<File, "name" | "size" | "type" | "lastModified">;
export type SupportDraft = { category: string; email: string; message: string };
export type SupportPreviewState = {
  draft: SupportDraft;
  attachments: SupportAttachment[];
  attachmentErrors: string[];
  errors: Partial<Record<keyof SupportDraft, string>>;
  stage: "editing" | "sending" | "error" | "sent";
};
export const initialSupportPreviewState: SupportPreviewState = {
  draft: { category: "", email: "", message: "" },
  attachments: [],
  attachmentErrors: [],
  errors: {},
  stage: "editing",
};

export function validateSupportDraft(draft: SupportDraft) {
  const errors: SupportPreviewState["errors"] = {};
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(draft.category))
    errors.category = "Choose a category.";
  if (draft.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    errors.email = "Enter a valid email address.";
  if (!draft.message.trim()) errors.message = "Describe what you need help with.";
  else if (draft.message.length > 4000)
    errors.message = "Keep your message within 4,000 characters.";
  return errors;
}

export function attachmentKey(file: SupportAttachment) {
  return `${file.name.toLowerCase()}\u0000${file.size}\u0000${file.lastModified}`;
}
export function validateSupportAttachments(
  existing: SupportAttachment[],
  incoming: SupportAttachment[],
) {
  const accepted = [...existing];
  const errors: string[] = [];
  const types: Record<string, string[]> = {
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "application/pdf": ["pdf"],
    "text/plain": ["txt"],
  };
  for (const file of incoming) {
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    let error = "";
    if (!types[file.type]?.includes(extension))
      error = "Use PNG, JPG, PDF or plain-text files with a matching file type.";
    else if (!Number.isFinite(file.size) || file.size <= 0)
      error = "Empty or invalid files cannot be attached.";
    else if (file.size > 5 * MIB) error = "Each attachment must be 5 MB or smaller.";
    else if (accepted.some((item) => attachmentKey(item) === attachmentKey(file)))
      error = "This attachment is already added.";
    else if (accepted.length >= 3) error = "Attach up to 3 files.";
    else if (accepted.reduce((total, item) => total + item.size, 0) + file.size > 10 * MIB)
      error = "Attachments must total 10 MB or less.";
    if (error) errors.push(`${file.name}: ${error}`);
    else accepted.push(file);
  }
  return { accepted, errors };
}

export type SupportPreviewAction =
  | { type: "edit"; field: keyof SupportDraft; value: string }
  | { type: "attach"; files: SupportAttachment[] }
  | { type: "remove"; key: string }
  | { type: "submit" }
  | { type: "result"; outcome: "sent" | "error" }
  | { type: "cancel" }
  | { type: "reset" };
export function supportPreviewReducer(
  state: SupportPreviewState,
  action: SupportPreviewAction,
): SupportPreviewState {
  if (action.type === "result")
    return state.stage === "sending" ? { ...state, stage: action.outcome } : state;
  if (action.type === "cancel")
    return state.stage === "sending" ? { ...state, stage: "editing" } : state;
  if (state.stage === "sending") return state;
  switch (action.type) {
    case "edit":
      return {
        ...state,
        stage: "editing",
        draft: { ...state.draft, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: undefined },
      };
    case "attach": {
      const result = validateSupportAttachments(state.attachments, action.files);
      return {
        ...state,
        stage: "editing",
        attachments: result.accepted,
        attachmentErrors: result.errors,
      };
    }
    case "remove":
      return {
        ...state,
        stage: "editing",
        attachments: state.attachments.filter((file) => attachmentKey(file) !== action.key),
        attachmentErrors: [],
      };
    case "submit": {
      const errors = validateSupportDraft(state.draft);
      return { ...state, errors, stage: Object.keys(errors).length ? "editing" : "sending" };
    }
    case "reset":
      return initialSupportPreviewState;
  }
}

export function SupportRequestPreview() {
  const [state, dispatch] = useReducer(supportPreviewReducer, initialSupportPreviewState);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const removeFocusRef = useRef<{ trigger: HTMLButtonElement; url: string } | null>(null);
  useLayoutEffect(() => {
    const origin = removeFocusRef.current;
    removeFocusRef.current = null;
    if (!origin || state.stage !== "editing") return;
    const active = document.activeElement;
    restoreDialogFocus(
      attachmentInputRef.current,
      origin.url,
      active !== null && active !== document.body && active !== origin.trigger,
    );
  }, [state.attachments, state.stage]);
  const categoryRef = useRef<HTMLSelectElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const focusIntentRef = useRef<"submit" | "reset" | null>(null);
  const previousStageRef = useRef<SupportPreviewState["stage"]>("editing");

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = state.stage;
    const intent = focusIntentRef.current;
    focusIntentRef.current = null;

    if (intent === "reset") {
      categoryRef.current?.focus();
      return;
    }
    if (intent === "submit") {
      const firstInvalidField = state.errors.category
        ? categoryRef.current
        : state.errors.email
          ? emailRef.current
          : state.errors.message
            ? messageRef.current
            : null;
      if (firstInvalidField) {
        firstInvalidField.focus();
        return;
      }
    }
    if (previousStage === state.stage) return;
    if (state.stage !== "editing") outcomeRef.current?.focus();
    else if (previousStage === "sending") submitRef.current?.focus();
  }, [state.stage, state.errors]);

  const busy = state.stage === "sending";
  return (
    <section
      aria-labelledby="support-preview-title"
      className="mx-auto w-full max-w-2xl rounded-3xl border border-border bg-card p-5 text-foreground sm:p-8"
    >
      <h2 id="support-preview-title" className="text-2xl font-semibold">
        Contact support
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Local review only. The support service is unavailable here. Nothing is transmitted; files
        are not read or uploaded. This draft lasts only while this preview is open.
      </p>
      <form
        className="mt-6 space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          focusIntentRef.current = "submit";
          dispatch({ type: "submit" });
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-70">
          <div>
            <Label htmlFor="preview-support-category">Category</Label>
            <select
              id="preview-support-category"
              ref={categoryRef}
              required
              value={state.draft.category}
              onChange={(event) =>
                dispatch({ type: "edit", field: "category", value: event.target.value })
              }
              aria-invalid={Boolean(state.errors.category)}
              aria-describedby={state.errors.category ? "preview-category-error" : undefined}
              className="mt-2 min-h-11 w-full rounded-2xl border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose a category</option>
              {SUPPORT_CATEGORIES.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            {state.errors.category && (
              <p id="preview-category-error" role="alert" className="mt-2 text-sm text-destructive">
                {state.errors.category}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="preview-support-email">Email</Label>
            <Input
              id="preview-support-email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              className="mt-2 min-h-11"
              value={state.draft.email}
              onChange={(event) =>
                dispatch({ type: "edit", field: "email", value: event.target.value })
              }
              aria-invalid={Boolean(state.errors.email)}
              aria-describedby={state.errors.email ? "preview-email-error" : undefined}
            />
            {state.errors.email && (
              <p id="preview-email-error" role="alert" className="mt-2 text-sm text-destructive">
                {state.errors.email}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="preview-support-message">Message</Label>
            <Textarea
              id="preview-support-message"
              ref={messageRef}
              required
              maxLength={4000}
              className="mt-2 min-h-36"
              placeholder="What happened, and what did you expect?"
              value={state.draft.message}
              onChange={(event) =>
                dispatch({ type: "edit", field: "message", value: event.target.value })
              }
              aria-invalid={Boolean(state.errors.message)}
              aria-describedby={`preview-message-count${state.errors.message ? " preview-message-error" : ""}`}
            />
            {state.errors.message && (
              <p id="preview-message-error" role="alert" className="mt-2 text-sm text-destructive">
                {state.errors.message}
              </p>
            )}
            <p id="preview-message-count" className="mt-2 text-right text-xs text-muted-foreground">
              {state.draft.message.length} / 4,000
            </p>
          </div>
          <div>
            <Label htmlFor="preview-support-files">Attachments (optional)</Label>
            <p id="preview-attachment-help" className="my-2 text-sm text-muted-foreground">
              PNG, JPG, PDF or TXT. Up to 3 files, 5 MB each and 10 MB total. Metadata checks only;
              contents are not inspected.
            </p>
            <Input
              id="preview-support-files"
              ref={attachmentInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.pdf,.txt,image/png,image/jpeg,application/pdf,text/plain"
              className="h-auto min-h-11 py-2"
              aria-describedby="preview-attachment-help"
              onChange={(event) => {
                dispatch({ type: "attach", files: Array.from(event.target.files ?? []) });
                event.target.value = "";
              }}
            />
            {state.attachmentErrors.length > 0 && (
              <ul
                role="alert"
                className="mt-2 space-y-1 text-sm text-destructive [overflow-wrap:anywhere]"
              >
                {state.attachmentErrors.map((error, index) => (
                  <li key={`${index}-${error}`}>{error}</li>
                ))}
              </ul>
            )}
            <ul aria-label="Attached files" className="mt-3 space-y-2">
              {state.attachments.map((file) => (
                <li
                  key={attachmentKey(file)}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border px-3 py-2"
                >
                  <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                    {file.name}{" "}
                    <span className="text-muted-foreground">
                      ({Math.ceil(file.size / 1024)} KB)
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 shrink-0"
                    aria-label={`Remove ${file.name}`}
                    onClick={(event) => {
                      if (busy) return;
                      removeFocusRef.current = {
                        trigger: event.currentTarget,
                        url: window.location.href,
                      };
                      dispatch({ type: "remove", key: attachmentKey(file) });
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </fieldset>
        {state.stage === "error" && (
          <p
            ref={outcomeRef}
            tabIndex={-1}
            role="alert"
            className="rounded-2xl border border-destructive/30 p-3 text-sm"
          >
            Simulated send failure. Your message and attachments are still here. Nothing was
            transmitted.
          </p>
        )}
        {state.stage === "sent" && (
          <p
            ref={outcomeRef}
            tabIndex={-1}
            role="status"
            className="rounded-2xl border border-border p-3 text-sm"
          >
            Local simulation complete: sent state. No support request was actually sent.
          </p>
        )}
        {busy ? (
          <div className="space-y-3 rounded-2xl border border-border p-4">
            <p ref={outcomeRef} tabIndex={-1} role="status" className="text-sm">
              Simulated sending. Choose an outcome below; no network request is running.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11"
                onClick={() => dispatch({ type: "result", outcome: "sent" })}
              >
                Simulate success
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => dispatch({ type: "result", outcome: "error" })}
              >
                Simulate failure
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => dispatch({ type: "cancel" })}
              >
                Cancel simulation
              </Button>
            </div>
          </div>
        ) : state.stage === "sent" ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              focusIntentRef.current = "reset";
              dispatch({ type: "reset" });
            }}
          >
            Start a new local draft
          </Button>
        ) : (
          <Button ref={submitRef} type="submit" className="min-h-11">
            {state.stage === "error" ? "Retry local simulation" : "Simulate send"}
          </Button>
        )}
      </form>
    </section>
  );
}
