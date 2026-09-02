import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronDown, Copy, ExternalLink, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect KovaGPT to Your AI Assistant" },
      {
        name: "description",
        content:
          "Connect KovaGPT to ChatGPT, Claude, Claude Code, and other AI assistants with a short guided setup.",
      },
      { property: "og:title", content: "Connect KovaGPT to Your AI Assistant" },
      {
        property: "og:description",
        content: "Connect KovaGPT to ChatGPT, Claude, Claude Code, and other AI assistants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://kovagpt.com/connect" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/connect" }],
  }),
  component: ConnectPage,
});

const SERVER_NAME = "kovagpt";
type ProviderId = "chatgpt" | "claude" | "claude-code" | "other";

const PROVIDERS: readonly { id: ProviderId; name: string; description: string }[] = [
  { id: "chatgpt", name: "ChatGPT", description: "Add KovaGPT as a custom app connection." },
  { id: "claude", name: "Claude", description: "Add KovaGPT as a custom connector." },
  { id: "claude-code", name: "Claude Code", description: "Connect from the Claude Code CLI." },
  { id: "other", name: "Another assistant", description: "Use any client that accepts remote MCP servers." },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!value}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        });
      }}
      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ConnectPage() {
  const [mcpUrl, setMcpUrl] = useState("");
  const [provider, setProvider] = useState<ProviderId>("chatgpt");

  useEffect(() => {
    setMcpUrl(new URL("/mcp", window.location.origin).toString());
  }, []);

  const claudeCodeCommand = useMemo(
    () =>
      mcpUrl
        ? `claude mcp add --scope user --transport http ${SERVER_NAME} '${mcpUrl.replace(/'/g, "'\\''")}'`
        : "",
    [mcpUrl],
  );

  const claudeLink = mcpUrl
    ? `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("KovaGPT")}&connectorUrl=${encodeURIComponent(mcpUrl)}`
    : "https://claude.ai/customize/connectors";

  return (
    <>
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <header className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            KovaGPT Connect
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Bring KovaGPT into the assistant you already use
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Choose your assistant, follow one short setup, then start using KovaGPT from that chat.
            The technical details stay available when you need them.
          </p>
        </header>

        <section className="mx-auto mt-12 max-w-4xl" aria-labelledby="choose-assistant">
          <div className="flex items-start gap-3">
            <StepNumber number={1} />
            <div>
              <h2 id="choose-assistant" className="text-xl font-semibold tracking-tight">
                Choose your assistant
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We will only show the setup steps for the option you choose.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {PROVIDERS.map((item) => {
              const selected = provider === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setProvider(item.id)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-foreground bg-card shadow-sm"
                      : "border-border bg-card/40 hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{item.name}</span>
                    <span
                      className={`grid h-6 w-6 place-items-center rounded-full border ${
                        selected ? "border-foreground bg-foreground text-background" : "border-border"
                      }`}
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-12 max-w-4xl" aria-labelledby="connect-steps">
          <div className="flex items-start gap-3">
            <StepNumber number={2} />
            <div>
              <h2 id="connect-steps" className="text-xl font-semibold tracking-tight">
                Connect KovaGPT
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You may be asked to sign in to KovaGPT so the assistant can act as your account.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-card/55 p-5 sm:p-6">
            <ProviderInstructions
              provider={provider}
              mcpUrl={mcpUrl}
              claudeLink={claudeLink}
              claudeCodeCommand={claudeCodeCommand}
            />
          </div>
        </section>

        <section className="mx-auto mt-12 max-w-4xl" aria-labelledby="start-using">
          <div className="flex items-start gap-3">
            <StepNumber number={3} />
            <div>
              <h2 id="start-using" className="text-xl font-semibold tracking-tight">
                Start using KovaGPT
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enable the connection in your assistant, then ask it to use KovaGPT for the task at
                hand.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-muted/25 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="font-medium">You are ready when the assistant shows KovaGPT as connected.</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                If the connection later looks stale, use the refresh instructions below rather than
                rebuilding everything from scratch.
              </p>
            </div>
            <Link
              to="/getting-started"
              className="mt-4 inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium transition hover:bg-accent sm:mt-0"
            >
              Getting started
            </Link>
          </div>
        </section>

        <section className="mx-auto mt-8 max-w-4xl">
          <details className="group rounded-2xl border border-border bg-card/35">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium sm:px-6">
              Technical setup and refresh instructions
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Connection URL
                </p>
                <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs sm:text-sm">
                    {mcpUrl || "Loading..."}
                  </code>
                  <CopyButton value={mcpUrl} label="Copy the KovaGPT connection URL" />
                </div>
              </div>

              <div className="mt-6">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Refresh later
                </p>
                <RefreshInstructions provider={provider} claudeCodeCommand={claudeCodeCommand} />
              </div>
            </div>
          </details>
        </section>

        <nav className="mx-auto mt-10 flex max-w-4xl flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-label="Connect resources">
          <Link to="/apps" className="underline underline-offset-4 hover:text-foreground">
            Connected apps
          </Link>
          <Link to="/contact-support" className="underline underline-offset-4 hover:text-foreground">
            Contact support
          </Link>
        </nav>
      </main>
      <PublicFooter />
    </>
  );
}

function StepNumber({ number }: { number: number }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
      {number}
    </span>
  );
}

function ProviderInstructions({
  provider,
  mcpUrl,
  claudeLink,
  claudeCodeCommand,
}: {
  provider: ProviderId;
  mcpUrl: string;
  claudeLink: string;
  claudeCodeCommand: string;
}) {
  if (provider === "claude-code") {
    return (
      <div>
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          <h3 className="font-semibold">Claude Code</h3>
        </div>
        <ol className="mt-4 space-y-4 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">1.</strong> Run this command in a terminal:
            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-xs text-foreground">
                {claudeCodeCommand || "Loading..."}
              </code>
              <CopyButton value={claudeCodeCommand} label="Copy the Claude Code install command" />
            </div>
          </li>
          <li>
            <strong className="text-foreground">2.</strong> Start Claude Code and run <code>/mcp</code>{" "}
            to confirm KovaGPT is connected. Sign in from that menu if prompted.
          </li>
          <li>
            <strong className="text-foreground">3.</strong> Ask Claude Code to use KovaGPT.
          </li>
        </ol>
      </div>
    );
  }

  if (provider === "claude") {
    return (
      <div>
        <h3 className="font-semibold">Claude</h3>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">1.</strong>{" "}
            <a
              href={claudeLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            >
              Open the prefilled Claude connector <ExternalLink className="h-3.5 w-3.5" />
            </a>
            .
          </li>
          <li>
            <strong className="text-foreground">2.</strong> Review the details and choose Add.
          </li>
          <li>
            <strong className="text-foreground">3.</strong> If the prefilled form does not open,
            create a custom connector named KovaGPT and paste this URL:
            <ConnectionValue value={mcpUrl} />
          </li>
          <li>
            <strong className="text-foreground">4.</strong> Enable KovaGPT from the composer and ask
            Claude to use it.
          </li>
        </ol>
      </div>
    );
  }

  if (provider === "other") {
    return (
      <div>
        <h3 className="font-semibold">Another assistant</h3>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">1.</strong> Open the assistant's connector or MCP
            server settings.
          </li>
          <li>
            <strong className="text-foreground">2.</strong> Create a remote connection named KovaGPT
            and use this URL:
            <ConnectionValue value={mcpUrl} />
          </li>
          <li>
            <strong className="text-foreground">3.</strong> Complete any sign-in or authorization
            prompts, then enable the connection.
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold">ChatGPT</h3>
      <ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
        <li>
          <strong className="text-foreground">1.</strong>{" "}
          <a
            href="https://chatgpt.com/#settings/Connectors/Advanced"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
          >
            Open ChatGPT Apps settings <ExternalLink className="h-3.5 w-3.5" />
          </a>{" "}
          and enable Developer mode if your account or workspace allows it.
        </li>
        <li>
          <strong className="text-foreground">2.</strong>{" "}
          <a
            href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
          >
            Open the new plugin dialog <ExternalLink className="h-3.5 w-3.5" />
          </a>
          , name it KovaGPT, and paste this URL:
          <ConnectionValue value={mcpUrl} />
        </li>
        <li>
          <strong className="text-foreground">3.</strong> Review ChatGPT's connection warning and
          create the connection only if you want to continue.
        </li>
        <li>
          <strong className="text-foreground">4.</strong> Enable KovaGPT in the composer, then ask
          ChatGPT to use it.
        </li>
      </ol>
    </div>
  );
}

function ConnectionValue({ value }: { value: string }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-foreground sm:text-sm">
        {value || "Loading..."}
      </code>
      <CopyButton value={value} label="Copy the KovaGPT connection URL" />
    </div>
  );
}

function RefreshInstructions({
  provider,
  claudeCodeCommand,
}: {
  provider: ProviderId;
  claudeCodeCommand: string;
}) {
  const copy = {
    chatgpt:
      "Open ChatGPT's Plugins page, select KovaGPT, and use Refresh. If the URL changed, remove KovaGPT and reconnect it with the latest URL.",
    claude:
      "Open Claude's Connectors page, select KovaGPT, and refresh or update its tools. If the URL changed, remove the connector and add it again.",
    "claude-code":
      "Start a new Claude Code session to reload tools. If the URL changed, remove the KovaGPT MCP server and run the install command again.",
    other:
      "Open the assistant's connector settings and refresh or reload KovaGPT. If the URL changed, update or recreate the remote connection.",
  }[provider];

  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
      <p>{copy}</p>
      {provider === "claude-code" ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-muted/35 p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-xs text-foreground">
            {claudeCodeCommand || "Loading..."}
          </code>
          <CopyButton value={claudeCodeCommand} label="Copy the Claude Code install command" />
        </div>
      ) : null}
    </div>
  );
}
