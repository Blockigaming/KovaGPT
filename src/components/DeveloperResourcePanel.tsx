import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  developerResourceSections,
  resourceConsoleJobDraft,
  resourceConsoleKey,
  resourceConsoleMaySpend,
  resourceConsolePromptDraft,
  resourceConsoleFollowups,
  resourceConsoleRequest,
  resourceConsoleRequiresConfirmation,
  resourceConsoleTemplate,
  type DeveloperResourceSection,
} from "@/lib/pricing/developer-resource-console.mjs";

type KeyRow = { id: string; name: string };
type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

async function readResult(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("No resource response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) throw new Error("Resource response exceeded the display limit.");
      body += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function DeveloperResourcePanel({
  section,
  enabled,
  keys,
}: {
  section: DeveloperResourceSection;
  enabled: boolean;
  keys: KeyRow[];
}) {
  const config = developerResourceSections[section];
  const [secret, setSecret] = useState("");
  const [action, setAction] = useState("list");
  const [input, setInput] = useState("{}");
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const retry = useRef<{ request: string; key: string } | null>(null);
  const token = resourceConsoleKey(
    secret,
    keys.map((key) => key.id),
  );
  const requiresConfirmation = resourceConsoleRequiresConfirmation(section, action);
  const maySpend = resourceConsoleMaySpend(section, action);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!enabled || !token) {
      active.current?.abort();
      setResult(null);
      setConfirmed(false);
    }
  }, [enabled, token]);

  const selectAction = (next: string, id?: string) => {
    let template = resourceConsoleTemplate(section, next, () => crypto.randomUUID());
    if (id) template = JSON.stringify({ id }, null, 2);
    setAction(next);
    setInput(template);
    setConfirmed(false);
    setResult(null);
    setError("");
    retry.current = null;
  };

  const promptInput = section === "prompts" ? record(JSON.parse(input)) : {};
  const promptDefinition = record(promptInput.definition);
  const changePromptInput = (fields: Row) => {
    setInput(JSON.stringify({ ...promptInput, ...fields }, null, 2));
    setConfirmed(false);
    setResult(null);
    setError("");
  };
  const preparePrompt = (next: "version" | "update" | "delete") => {
    try {
      const draft = resourceConsolePromptDraft(next, result);
      setAction(next);
      setInput(draft);
      setConfirmed(false);
      setResult(null);
      setError("");
      retry.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare prompt.");
    }
  };

  const run = async () => {
    if (!enabled || !token || active.current || (requiresConfirmation && !confirmed)) return;
    setError("");
    setResult(null);
    setConfirmed(false);
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    try {
      const request = resourceConsoleRequest(section, action, input);
      const fingerprint = request.method + "\n" + request.path + "\n" + (request.body ?? "");
      if (retry.current?.request !== fingerprint)
        retry.current = { request: fingerprint, key: crypto.randomUUID() };
      const response = await fetch(request.path, {
        method: request.method,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: "Bearer " + token,
          ...(request.body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Idempotency-Key": retry.current.key,
              }),
        },
        body: request.body,
      });
      const value = await readResult(response);
      if (!response.ok) {
        const code = record(record(value).error).code;
        throw new Error(
          typeof code === "string" && /^developer_[a-z_]+$/.test(code)
            ? code.replaceAll("_", " ")
            : "Resource request failed (" + response.status + ").",
        );
      }
      if (mounted.current && !controller.signal.aborted) setResult(value);
    } catch (cause) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "Request canceled or timed out. Inspect the resource before repeating a mutation."
            : cause instanceof Error
              ? cause.message
              : "Resource request failed.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const prepareJob = () => {
    try {
      const draft = resourceConsoleJobDraft(section, action, input, result, () =>
        crypto.randomUUID(),
      );
      setAction("create");
      setInput(draft);
      setConfirmed(false);
      setResult(null);
      setError("");
      retry.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the job.");
    }
  };
  const followups =
    result === null
      ? []
      : resourceConsoleFollowups(
          section,
          action,
          input,
          result,
          () => "00000000-0000-4000-8000-000000000000",
        );
  const prepareFollowup = (next: (typeof followups)[number]) => {
    const draft = JSON.parse(next.draft);
    if (next.action === "test") draft.event_id = crypto.randomUUID();
    setAction(next.action);
    setInput(JSON.stringify(draft, null, 2));
    setConfirmed(false);
    setResult(null);
    setError("");
    retry.current = null;
  };
  const data = record(result).data;
  const rows = Array.isArray(data) ? data.map(record) : null;
  const signingSecret = record(result).signing_secret;
  const publicResult =
    typeof signingSecret === "string"
      ? Object.fromEntries(
          Object.entries(record(result)).filter(([key]) => key !== "signing_secret"),
        )
      : result;

  return (
    <section className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{config.label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{config.description}</p>
      </header>
      {!enabled && (
        <p role="status" className="rounded-lg border border-border p-3 text-sm">
          Select a project with enabled API execution. Resource-specific availability is checked by
          the API.
        </p>
      )}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4 rounded-[var(--kova-radius-panel)] border border-border p-4">
          <label className="block space-y-1 text-sm">
            <span>Project API key</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              disabled={busy || !enabled || !keys.length}
              placeholder="kova_…"
              onChange={(event) => {
                setSecret(event.target.value);
                setResult(null);
                setError("");
                setConfirmed(false);
                retry.current = null;
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {keys.length
              ? "Use an active key belonging to this project. The secret stays in this mounted screen."
              : "Create an active key in this project first."}
          </p>
          {secret && !token && (
            <p role="alert" className="text-sm text-destructive">
              This credential does not match an active key in the selected project.
            </p>
          )}
          <label className="block space-y-1 text-sm">
            <span>Operation</span>
            <select
              className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
              value={action}
              disabled={busy}
              onChange={(event) => selectAction(event.target.value)}
            >
              {Object.entries(config.actions).map(([id, option]) => (
                <option key={id} value={id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {section === "prompts" && action !== "list" && (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Prompt ID</span>
                <Input
                  value={String(promptInput.id ?? "")}
                  readOnly={action === "create"}
                  disabled={busy}
                  onChange={(event) => changePromptInput({ id: event.target.value })}
                />
              </label>
              {(action === "version" || action === "update") && (
                <label className="block space-y-1 text-sm">
                  <span>{action === "update" ? "Current version" : "Version to retrieve"}</span>
                  <Input
                    type="number"
                    min={1}
                    max={action === "update" ? 19 : 20}
                    value={String(
                      promptInput[action === "update" ? "expected_version" : "version"] ?? "",
                    )}
                    disabled={busy}
                    onChange={(event) =>
                      changePromptInput({
                        [action === "update" ? "expected_version" : "version"]: Number(
                          event.target.value,
                        ),
                      })
                    }
                  />
                </label>
              )}
              {(action === "create" || action === "update") && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Name</span>
                    <Input
                      maxLength={160}
                      value={String(promptDefinition.name ?? "")}
                      disabled={busy}
                      onChange={(event) =>
                        changePromptInput({
                          definition: { ...promptDefinition, name: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Description</span>
                    <Input
                      maxLength={512}
                      value={String(promptDefinition.description ?? "")}
                      disabled={busy}
                      onChange={(event) =>
                        changePromptInput({
                          definition: { ...promptDefinition, description: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Prompt text</span>
                    <Textarea
                      rows={9}
                      maxLength={4000}
                      value={String(promptDefinition.prompt ?? "")}
                      disabled={busy}
                      onChange={(event) =>
                        changePromptInput({
                          definition: { ...promptDefinition, prompt: event.target.value },
                        })
                      }
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Text is stored privately and never executed automatically. Limits are measured
                    in UTF-8 bytes.
                  </p>
                </>
              )}
              {action === "delete" && (
                <p className="text-sm text-muted-foreground">
                  Deleting this prompt removes every saved version.
                </p>
              )}
            </div>
          )}
          {section !== "prompts" && Object.keys(config.actions[action].fields).length > 0 && (
            <label className="block space-y-1 text-sm">
              <span>Request fields (JSON)</span>
              <Textarea
                className="min-w-0 font-mono text-xs"
                rows={9}
                spellCheck={false}
                disabled={busy}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setConfirmed(false);
                  setResult(null);
                  setError("");
                }}
              />
            </label>
          )}
          {maySpend && action === "create" && (
            <p className="text-xs text-muted-foreground">
              Get a quote for each exact input first. Supply the signed quote token and a positive
              maximum charge in the matching currency. The server rejects expired or changed quotes.
            </p>
          )}
          {requiresConfirmation && (
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !enabled}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                {section === "mcp-connections" && action === "invoke"
                  ? "Authorize this read of the delegated external service. Third-party charges may apply."
                  : maySpend
                    ? "Authorize paid execution for this project within the submitted budget."
                    : "Confirm " +
                      config.actions[action].label.toLowerCase() +
                      " for this project."}
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!enabled || !token || busy || (requiresConfirmation && !confirmed)}
              onClick={() => void run()}
            >
              {config.actions[action].label}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => selectAction(action)}>
              Reset request
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => active.current?.abort()}>
                Cancel request
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-4 rounded-[var(--kova-radius-panel)] border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Resource response</h2>
            {result !== null && (
              <Button variant="ghost" disabled={busy} onClick={() => setResult(null)}>
                Clear response
              </Button>
            )}
          </div>
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Request in progress…
            </p>
          )}
          {config.actions[action].path === "/api/v1/quotes" && result !== null && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm">
                Prepare a job using this exact quote. You still need to enter and approve the
                spending limit before submission.
              </p>
              <Button variant="outline" disabled={busy || !enabled || !token} onClick={prepareJob}>
                Prepare job from quote
              </Button>
            </div>
          )}
          {typeof signingSecret === "string" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Signing secret — copy and store securely.</p>
              <Input readOnly value={signingSecret} aria-label="Webhook signing secret" />
              <p className="text-xs text-muted-foreground">
                This secret is cleared when you leave the screen or make another request.
              </p>
            </div>
          )}
          {rows && action === "list" && (
            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li
                  key={String(row.id ?? index)}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {String(row.name ?? row.title ?? row.id ?? "Resource")}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {String(row.id ?? "")}
                    </p>
                  </div>
                  {typeof row.id === "string" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => selectAction("detail", String(row.id))}
                    >
                      Inspect
                    </Button>
                  )}
                </li>
              ))}
              {!rows.length && <li className="text-sm text-muted-foreground">No resources.</li>}
            </ul>
          )}
          {section === "prompts" && record(result).object === "prompt.definition" && (
            <div className="space-y-3">
              <p className="break-words text-sm font-medium">
                {String(record(record(result).definition).name ?? "Prompt")} · Version{" "}
                {String(record(result).version)}
              </p>
              <Textarea
                readOnly
                rows={8}
                value={String(record(record(result).definition).prompt ?? "")}
                aria-label="Saved prompt text"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !enabled || !token}
                  onClick={() => preparePrompt("version")}
                >
                  Retrieve version
                </Button>
                {action !== "version" && Number(record(result).version) < 20 && (
                  <Button
                    variant="outline"
                    disabled={busy || !enabled || !token}
                    onClick={() => preparePrompt("update")}
                  >
                    Create new version
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy || !enabled || !token}
                  onClick={() => preparePrompt("delete")}
                >
                  Delete prompt
                </Button>
              </div>
            </div>
          )}
          {!!followups.length && (
            <div className="space-y-2" aria-label="Resource actions">
              <h3 className="text-sm font-medium">Next actions</h3>
              <p className="text-xs text-muted-foreground">
                Prepare a request from this response. Mutations still require confirmation.
              </p>
              {followups.map((next) => (
                <Button
                  key={next.action + next.draft}
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start whitespace-normal break-all text-left"
                  disabled={busy || !enabled || !token}
                  onClick={() => prepareFollowup(next)}
                >
                  {next.label}
                </Button>
              ))}
            </div>
          )}
          {result !== null ? (
            <pre className="max-h-[32rem] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-[var(--kova-radius-output)] bg-muted/40 p-4 text-xs">
              {JSON.stringify(publicResult, null, 2)}
            </pre>
          ) : (
            !busy && <p className="text-sm text-muted-foreground">Run a resource operation.</p>
          )}
        </div>
      </div>
    </section>
  );
}
