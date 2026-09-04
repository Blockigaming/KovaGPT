import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect KovaGPT to Your AI Assistant" },
      {
        name: "description",
        content:
          "Step by step instructions to connect KovaGPT to ChatGPT, Claude, Claude Code, and other AI assistants, plus how to refresh the connection later.",
      },
      { property: "og:title", content: "Connect KovaGPT to Your AI Assistant" },
      {
        property: "og:description",
        content:
          "Step by step instructions to connect KovaGPT to ChatGPT, Claude, Claude Code, and other AI assistants.",
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!value}
      onClick={async () => {
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
          toast.error(
            "Could not copy the connection details. Select the text and copy it manually.",
          );
        }
      }}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Steps({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
    </div>
  );
}

function ConnectPage() {
  const [mcpUrl, setMcpUrl] = useState("");

  useEffect(() => {
    setMcpUrl(new URL("/mcp", window.location.origin).toString());
  }, []);

  const claudeCodeCommand = mcpUrl
    ? `claude mcp add --scope user --transport http ${SERVER_NAME} '${mcpUrl.replace(/'/g, "'\\''")}'`
    : "";

  const claudeLink = mcpUrl
    ? `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("KovaGPT")}&connectorUrl=${encodeURIComponent(mcpUrl)}`
    : "https://claude.ai/customize/connectors";

  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="mb-3 text-4xl font-bold tracking-tight">
          Connect KovaGPT to your assistant
        </h1>
        <p className="mb-10 text-muted-foreground">
          Link KovaGPT to ChatGPT, Claude, Claude Code, or another AI assistant so it can work with
          your projects, tasks, and notes directly from your chat.
        </p>

        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold">1. Copy your KovaGPT connection URL</h2>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <code className="min-w-0 flex-1 truncate text-sm">{mcpUrl || "Loading..."}</code>
            <CopyButton value={mcpUrl} label="Copy the KovaGPT connection URL" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            You will paste this URL into your assistant below. You may be asked to sign in to your
            KovaGPT account so the assistant acts as you.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">2. Connect your assistant</h2>
          <div className="space-y-4">
            <Steps
              title="ChatGPT"
              items={[
                <>
                  Open{" "}
                  <a
                    href="https://chatgpt.com/#settings/Connectors/Advanced"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    ChatGPT Apps settings
                  </a>{" "}
                  and turn on Developer mode, reading the risk notice shown there. If the option is
                  missing, ask a ChatGPT admin to enable it.
                </>,
                <>
                  Open the{" "}
                  <a
                    href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    New plugin dialog
                  </a>
                  .
                </>,
                <>Enter the name KovaGPT and paste the URL from above into the URL field.</>,
                <>
                  Review the details, check "I understand and want to continue" (ChatGPT shows this
                  warning for every custom connection), then click Create.
                </>,
                <>Enable KovaGPT from the chat composer, then ask ChatGPT to use KovaGPT.</>,
              ]}
            />

            <Steps
              title="Claude"
              items={[
                <>
                  Open the{" "}
                  <a
                    href={claudeLink}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    prefilled Claude connector dialog
                  </a>
                  .
                </>,
                <>Review the details and click Add.</>,
                <>
                  If the prefilled form does not open, go to Claude Connectors, choose Add custom
                  connector, name it KovaGPT, and paste the URL from above.
                </>,
                <>Enable the connector from the chat composer, then ask Claude to use KovaGPT.</>,
              ]}
            />

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-semibold">Claude Code</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                <li>
                  Run this command in a terminal:
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-xs text-foreground">
                      {claudeCodeCommand || "Loading..."}
                    </code>
                    <CopyButton
                      value={claudeCodeCommand}
                      label="Copy the Claude Code install command"
                    />
                  </div>
                </li>
                <li>
                  Start Claude Code and run <code>/mcp</code> to confirm KovaGPT is connected. Sign
                  in from that menu if prompted.
                </li>
                <li>Ask Claude Code to use KovaGPT.</li>
              </ol>
            </div>

            <Steps
              title="Other AI assistants"
              items={[
                <>Open the assistant's connector or MCP server settings.</>,
                <>Create a new remote connection.</>,
                <>Name it KovaGPT and paste the URL from above.</>,
                <>Finish any sign in or authorization prompts.</>,
                <>Enable the connection, then ask the assistant to use KovaGPT.</>,
              ]}
            />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-2 text-lg font-semibold">3. Refresh after KovaGPT updates</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Assistants remember what KovaGPT could do when you first connected. Refresh the
            connection to pick up the latest features.
          </p>
          <div className="space-y-4">
            <Steps
              title="ChatGPT"
              items={[
                <>Open the ChatGPT Plugins page and select KovaGPT.</>,
                <>Scroll to Information and click Refresh.</>,
                <>
                  ChatGPT cannot change an existing URL. If the URL above changed, delete KovaGPT
                  from Plugins and connect again.
                </>,
                <>Start a new chat and ask ChatGPT to use KovaGPT.</>,
              ]}
            />
            <Steps
              title="Claude"
              items={[
                <>Open the Connectors page and select KovaGPT.</>,
                <>Refresh or update the connector tools.</>,
                <>
                  Claude cannot change an existing connector URL. If the URL above changed, remove
                  the connector and connect again.
                </>,
                <>Ask Claude to use KovaGPT.</>,
              ]}
            />
            <Steps
              title="Claude Code"
              items={[
                <>Start a new Claude Code session so it reloads the latest KovaGPT features.</>,
                <>
                  If the URL changed, run <code>claude mcp remove {SERVER_NAME}</code> and run the
                  install command again.
                </>,
                <>Ask Claude Code to use KovaGPT.</>,
              ]}
            />
            <Steps
              title="Other AI assistants"
              items={[
                <>Open the assistant's connector or MCP server settings.</>,
                <>Select the KovaGPT connection.</>,
                <>Refresh the tools, reload the server, or reconnect it.</>,
                <>If the URL changed, paste the latest URL from above.</>,
                <>Start a new chat or session and ask the assistant to use KovaGPT.</>,
              ]}
            />
          </div>
        </section>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/getting-started" className="underline hover:text-foreground">
            Getting started
          </Link>
          <Link to="/apps" className="underline hover:text-foreground">
            Connected apps
          </Link>
          <Link to="/contact-support" className="underline hover:text-foreground">
            Contact support
          </Link>
        </div>
      </main>
    </PublicShell>
  );
}
