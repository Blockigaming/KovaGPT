import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const TOPICS = [
  "Account & sign-in",
  "Billing & subscription",
  "Chat or responses",
  "Projects",
  "Apps & integrations",
  "Images",
  "Bug report",
  "Feature request",
  "Privacy & security",
  "Other",
];

type SupportDraft = {
  name: string;
  email: string;
  topic: string;
  message: string;
  website: string;
  status: "idle" | "sending" | "sent" | "error" | "uncertain";
  submissionError: string;
  submittedEmail: string;
  touched: boolean;
};

const emptyDraft = (): SupportDraft => ({
  name: "",
  email: "",
  topic: "",
  message: "",
  website: "",
  status: "idle",
  submissionError: "",
  submittedEmail: "",
  touched: false,
});

// Browser memory only: effects and event handlers own these records, so support
// text never reaches persistent storage or a shared server-render request cache.
const drafts = new Map<string | null, SupportDraft>();
function interruptDraft(owner: string | null | undefined) {
  if (owner === undefined) return;
  const draft = drafts.get(owner);
  if (draft?.status !== "sending") return;
  drafts.set(owner, {
    ...draft,
    status: "uncertain",
    submissionError:
      "You left this support form before we could confirm whether support accepted this request. Check for a reply before sending another copy. There is no automatic retry.",
  });
}

export function HelpSupportForm() {
  const { user, isLoaded } = useUser();
  const [draft, setDraft] = useState<SupportDraft>(emptyDraft);
  const draftRef = useRef(draft);
  const { name, email, topic, message, website, status, submissionError, submittedEmail, touched } =
    draft;
  const initializedFor = useRef<string | null | undefined>(undefined);
  const operation = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const resetIntent = useRef<symbol | null>(null);
  const scope = isLoaded === false ? undefined : (user?.id ?? null);
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    operation.current = null;
    resetIntent.current = null;
  }
  const resultRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
      resetIntent.current = null;
      // A detached lifetime cannot confirm the result. Keep its duplicate-send
      // fence rather than restoring an idle form when the route mounts again.
      interruptDraft(initializedFor.current);
    };
  }, []);
  useEffect(() => {
    const userKey = isLoaded === false ? undefined : (user?.id ?? null);
    if (initializedFor.current === userKey) return;
    interruptDraft(initializedFor.current);
    initializedFor.current = userKey;
    operation.current = null;
    if (userKey === undefined) return;
    const next = drafts.get(userKey) ?? {
      ...emptyDraft(),
      name: user?.fullName ?? user?.firstName ?? "",
      email: user?.primaryEmailAddress?.emailAddress ?? "",
    };
    drafts.set(userKey, next);
    draftRef.current = next;
    setDraft(next);
  }, [user, isLoaded]);
  const updateDraft = (patch: Partial<SupportDraft>) => {
    if (
      !mounted.current ||
      scope === undefined ||
      currentScope.current !== scope ||
      initializedFor.current !== scope
    )
      return;
    // Save synchronously, including multiple edits before a render/navigation.
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    drafts.set(scope, next);
    setDraft(next);
  };
  const cleanEmail = email.trim();
  const emailError = !cleanEmail
    ? "Enter your email address."
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
      ? "Enter a valid email address."
      : "";
  const messageError = !message.trim()
    ? "Write a message before sending."
    : message.length > 4000
      ? "Messages can be up to 4,000 characters."
      : "";
  const invalid = Boolean(emailError || messageError);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !mounted.current ||
      scope === undefined ||
      currentScope.current !== scope ||
      initializedFor.current !== scope ||
      operation.current ||
      ["sending", "uncertain", "sent"].includes(drafts.get(scope)?.status ?? "idle")
    )
      return;
    updateDraft({ touched: true, submissionError: "" });
    if (invalid) {
      document.getElementById(emailError ? "support-email" : "support-message")?.focus();
      return;
    }
    const request = Symbol("support submission");
    resetIntent.current = request;
    operation.current = request;
    const owner = scope;
    const origin = document.activeElement;
    const current = () =>
      mounted.current && currentScope.current === owner && operation.current === request;
    const focusResult = () =>
      requestAnimationFrame(() => {
        if (!mounted.current || currentScope.current !== owner || resetIntent.current !== request)
          return;
        if (
          document.activeElement === origin ||
          document.activeElement === document.body ||
          document.activeElement === pendingRef.current
        )
          resultRef.current?.focus();
      });
    pendingRef.current?.focus();
    updateDraft({ status: "sending" });
    try {
      const response = await fetchWithTimeout(
        "/api/public/help-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email: cleanEmail,
            topic,
            message: message.trim(),
            variant: "help",
            website,
            url: window.location.href,
            userAgent: navigator.userAgent,
          }),
        },
        20_000,
      );
      const payload = (await response.json().catch(() => null)) as {
        success?: unknown;
        error?: unknown;
      } | null;
      if (!current()) return;
      if (response.ok && payload?.success === true) {
        updateDraft({ submittedEmail: cleanEmail, status: "sent" });
      } else if (response.status >= 400 && response.status < 500) {
        updateDraft({
          submissionError:
            response.status === 429
              ? "Too many support requests. Wait before sending again."
              : "Support did not accept this request. Review the email address and message before trying again.",
          status: "error",
        });
      } else {
        updateDraft({
          submissionError:
            "We couldn’t confirm whether support accepted this request. Check for a reply before sending it again; sending another copy could create a duplicate. There is no automatic retry.",
          status: "uncertain",
        });
      }
      focusResult();
    } catch {
      if (!current()) return;
      updateDraft({
        submissionError:
          "The connection ended before we could confirm whether support accepted this request. Check for a reply before sending another copy. There is no automatic retry.",
        status: "uncertain",
      });
      focusResult();
    } finally {
      if (current()) operation.current = null;
    }
  };
  if (scope === undefined || initializedFor.current !== scope)
    return (
      <section id="support-form" role="status">
        Loading support form…
      </section>
    );
  if (status === "sent")
    return (
      <section id="support-form" className="mt-20 border-t border-border pt-12 sm:mt-24 sm:pt-16">
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 text-center sm:p-10"
        >
          <CheckCircle2 className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-2xl font-semibold">Request accepted</h2>
          <p className="mx-auto mt-2 max-w-lg text-left text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            The support service accepted your request. Your reply address is {submittedEmail}.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={(event) => {
              const origin = event.currentTarget;
              const owner = scope;
              const intent = Symbol("new support message");
              resetIntent.current = intent;
              updateDraft({
                status: "idle",
                message: "",
                topic: "",
                touched: false,
                submissionError: "",
                submittedEmail: "",
              });
              requestAnimationFrame(() => {
                if (
                  !mounted.current ||
                  currentScope.current !== owner ||
                  resetIntent.current !== intent
                )
                  return;
                resetIntent.current = null;
                if (document.activeElement === origin || document.activeElement === document.body)
                  document.getElementById("support-message")?.focus();
              });
            }}
          >
            Send another message
          </Button>
        </div>
      </section>
    );
  return (
    <section
      id="support-form"
      className="mt-20 border-t border-border pt-12 sm:mt-24 sm:pt-16"
      aria-labelledby="support-heading"
    >
      <div className="mb-7 text-center">
        <h2 id="support-heading" className="text-2xl font-semibold sm:text-3xl">
          Still need help?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-left text-sm leading-6 text-muted-foreground sm:text-base">
          Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll
          reply by email.
        </p>
      </div>
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/70 p-5 sm:p-8">
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <Label htmlFor="support-name">Name</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Input
                id="support-name"
                autoComplete="name"
                maxLength={120}
                value={name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                className="h-12"
              />
            </div>
            <div>
              <div className="mb-2 flex items-baseline">
                <Label htmlFor="support-email">
                  Email{" "}
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
              </div>
              <Input
                id="support-email"
                className="h-12"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onBlur={() => updateDraft({ touched: true })}
                onChange={(e) => updateDraft({ email: e.target.value })}
                required
                aria-invalid={touched && Boolean(emailError)}
                aria-describedby={touched && emailError ? "support-email-error" : undefined}
              />
              {touched && emailError && (
                <p
                  id="support-email-error"
                  role="alert"
                  className="mt-1.5 text-sm text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <Label htmlFor="support-topic">Topic</Label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <SearchablePicker
              id="support-topic"
              aria-label="Topic"
              value={topic}
              onValueChange={(value) => updateDraft({ topic: value })}
              searchLabel="Search support topics"
              options={[
                { value: "", label: "Choose a topic" },
                ...TOPICS.map((item) => ({ value: item, label: item })),
              ]}
            />
          </div>
          <div>
            <Label htmlFor="support-message">
              Message{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </Label>
            <Textarea
              id="support-message"
              className="mt-2 min-h-40 resize-y"
              maxLength={4000}
              value={message}
              onBlur={() => updateDraft({ touched: true })}
              onChange={(e) => updateDraft({ message: e.target.value })}
              required
              aria-invalid={touched && Boolean(messageError)}
              aria-describedby={`support-message-count${touched && messageError ? " support-message-error" : ""}`}
              placeholder="Tell us what happened, what you expected, and any error message you saw."
            />
            {touched && messageError && (
              <p
                id="support-message-error"
                role="alert"
                className="mt-1.5 text-sm text-destructive"
              >
                {messageError}
              </p>
            )}
            <p
              id="support-message-count"
              className={`mt-2 text-right text-xs ${message.length >= 3600 ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {message.length.toLocaleString()} / 4,000
            </p>
          </div>
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => updateDraft({ website: e.target.value })}
            className="absolute -left-[9999px] size-px"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              We’ll use your email only to respond to this support request.
            </p>
            <Button
              type="submit"
              className="h-12 w-full shrink-0 px-6 sm:w-auto"
              disabled={status === "sending" || status === "uncertain"}
            >
              {status === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Sending…
                </>
              ) : (
                "Send message"
              )}
            </Button>
          </div>
          {/* Feedback follows the action so wrapped pending/error text cannot move Send. */}
          <p
            ref={pendingRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            aria-label="Support request status"
            className={status === "sending" ? "text-sm text-muted-foreground" : "sr-only"}
          >
            {status === "sending"
              ? "Sending your support request. Waiting for confirmation…"
              : "Support request status"}
          </p>
          {(status === "error" || status === "uncertain") && (
            <div
              ref={resultRef}
              tabIndex={-1}
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground"
            >
              {submissionError} Your message is still here.
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
