import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, Bot, Building2, Cable, GitBranch, Network, ServerCog } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  emptyPipeline,
  loadOmega,
  saveOmega,
  type AgentDefinition,
  type EnterpriseDraft,
  type McpDraft,
} from "@/lib/omega-store";
import {
  canTransitionAgent,
  simulatePipeline,
  type AgentRunState,
  type PipelineDefinition,
  type PipelineNode,
} from "@/platform/omega";
import { providerAdapters } from "@/platform/providers";

export const Route = createFileRoute("/omega")({
  component: OmegaPage,
  head: () => ({
    meta: [{ title: "Omega Control Center | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
type Tab =
  | "collaboration"
  | "execution"
  | "enterprise"
  | "mcp"
  | "providers"
  | "agents"
  | "pipelines";
const tabs: [Tab, string, typeof Activity][] = [
  ["collaboration", "Collaboration", Network],
  ["execution", "Execution", Activity],
  ["enterprise", "Enterprise", Building2],
  ["mcp", "MCP", Cable],
  ["providers", "Providers", ServerCog],
  ["agents", "Agent Studio", Bot],
  ["pipelines", "Pipeline Builder", GitBranch],
];
const unavailable = (label: string) => (
  <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
    <strong>{label} adapter not connected.</strong>
    <p className="mt-1 text-xs text-muted-foreground">
      Configuration can be prepared here, but KovaGPT will not claim the service is running until an
      authorized backend reports healthy.
    </p>
  </div>
);

function OmegaPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const scope = user?.id ?? "signed-out";
  const [tab, setTab] = useState<Tab>("collaboration");
  if (!isLoaded)
    return (
      <AppShell>
        <main className="p-6" aria-label="Loading Omega">
          <div className="h-48 animate-pulse rounded-2xl bg-muted" />
        </main>
      </AppShell>
    );
  if (!isSignedIn)
    return (
      <AppShell>
        <main className="mx-auto max-w-xl p-8 text-center">
          <h1 className="text-2xl font-semibold">Omega Control Center</h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to prepare account-scoped platform integrations.
          </p>
        </main>
      </AppShell>
    );
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <header>
          <h1 className="text-2xl font-semibold">Omega Control Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Backend-ready orchestration surfaces. Drafts are local until their corresponding service
            is connected.
          </p>
        </header>
        <div className="my-5 flex gap-1 overflow-x-auto" role="tablist" aria-label="Omega systems">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm ${tab === id ? "bg-foreground text-background" : "hover:bg-accent"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        {tab === "collaboration" ? (
          <CollaborationPanel />
        ) : tab === "execution" ? (
          <ExecutionPanel />
        ) : tab === "enterprise" ? (
          <EnterprisePanel scope={scope} />
        ) : tab === "mcp" ? (
          <McpPanel scope={scope} />
        ) : tab === "providers" ? (
          <ProviderPanel />
        ) : tab === "agents" ? (
          <AgentPanel scope={scope} />
        ) : (
          <PipelinePanel scope={scope} />
        )}
      </main>
    </AppShell>
  );
}

function CollaborationPanel() {
  return (
    <section aria-labelledby="collab-title">
      <h2 id="collab-title" className="text-lg font-semibold">
        Realtime collaboration readiness
      </h2>
      <div className="mt-3">{unavailable("Realtime")}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Presence", "Offline until a presence adapter connects"],
          ["Cursors", "Anchors and offsets use the typed realtime event contract"],
          ["Typing", "Indicators expire when the adapter disconnects"],
          ["Conflicts", "Local, remote, and manual merge strategies are supported"],
        ].map(([title, text]) => (
          <article key={title} className="rounded-xl border p-4">
            <h3 className="font-medium">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{text}</p>
          </article>
        ))}
      </div>
      <h3 className="mt-5 font-medium">Connection lifecycle</h3>
      <ol className="mt-2 flex flex-wrap gap-2 text-xs">
        {["Unsupported", "Connecting", "Connected", "Reconnecting", "Offline", "Failed"].map(
          (state) => (
            <li key={state} className="rounded-full border px-3 py-1.5">
              {state}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function ExecutionPanel() {
  const states: AgentRunState[] = [
    "queued",
    "waiting",
    "planning",
    "running",
    "approval_needed",
    "paused",
    "failed",
    "completed",
    "cancelled",
  ];
  const [current, setCurrent] = useState<AgentRunState>("queued");
  return (
    <section aria-labelledby="execution-title">
      <h2 id="execution-title" className="text-lg font-semibold">
        Background execution inspector
      </h2>
      <div className="mt-3">{unavailable("Agent runner")}</div>
      <div className="mt-4 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">State-machine preview</h3>
          <span className="rounded-full bg-muted px-2 py-1 text-xs">
            {current.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Only legal transitions are enabled. This previews orchestration; it does not start
          background work.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {states.map((state) => (
            <button
              key={state}
              disabled={!canTransitionAgent(current, state)}
              onClick={() => setCurrent(state)}
              className="min-h-10 rounded-lg border px-3 text-xs enabled:hover:bg-accent disabled:opacity-40"
            >
              {state.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const defaultEnterprise: EnterpriseDraft = {
  organizationName: "",
  defaultRole: "viewer",
  retentionDays: 365,
  ssoDomain: "",
  scimEndpoint: "",
  policies: { externalSharing: false, connectorWrites: false },
};
function EnterprisePanel({ scope }: { scope: string }) {
  const [draft, setDraft] = useState(() => loadOmega(scope, "enterprise", defaultEnterprise));
  const save = () => saveOmega(scope, "enterprise", draft);
  return (
    <section aria-labelledby="enterprise-title">
      <h2 id="enterprise-title" className="text-lg font-semibold">
        Enterprise preparation
      </h2>
      <div className="mt-3">{unavailable("Organization service")}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Organization name
          <input
            value={draft.organizationName}
            onChange={(e) => setDraft({ ...draft, organizationName: e.target.value })}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <label className="text-sm">
          Default role
          <select
            value={draft.defaultRole}
            onChange={(e) =>
              setDraft({ ...draft, defaultRole: e.target.value as EnterpriseDraft["defaultRole"] })
            }
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          >
            <option>viewer</option>
            <option>editor</option>
            <option>admin</option>
          </select>
        </label>
        <label className="text-sm">
          Retention days
          <input
            type="number"
            min={1}
            value={draft.retentionDays}
            onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <label className="text-sm">
          SSO domain
          <input
            value={draft.ssoDomain}
            onChange={(e) => setDraft({ ...draft, ssoDomain: e.target.value })}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          SCIM endpoint
          <input
            value={draft.scimEndpoint}
            onChange={(e) => setDraft({ ...draft, scimEndpoint: e.target.value })}
            placeholder="https://"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          />
        </label>
      </div>
      <button
        onClick={save}
        className="mt-4 min-h-10 rounded-lg border px-4 text-sm hover:bg-accent"
      >
        Save local configuration draft
      </button>
      <p className="mt-2 text-xs text-muted-foreground">
        Invitations, teams, audit retention, SSO verification, and SCIM provisioning remain disabled
        until an organization backend validates this configuration.
      </p>
    </section>
  );
}

function McpPanel({ scope }: { scope: string }) {
  const [servers, setServers] = useState<McpDraft[]>(() => loadOmega(scope, "mcp", []));
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const add = () => {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:") return;
      const next = [
        ...servers,
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          endpoint: url.toString(),
          version: "unverified",
          capabilities: [],
          permissions: [],
          status: "unverified" as const,
        },
      ];
      setServers(next);
      saveOmega(scope, "mcp", next);
      setName("");
      setEndpoint("");
    } catch {
      return;
    }
  };
  return (
    <section aria-labelledby="mcp-title">
      <h2 id="mcp-title" className="text-lg font-semibold">
        MCP server registry
      </h2>
      <div className="mt-3">{unavailable("MCP discovery")}</div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input
          aria-label="Server name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          className="h-10 rounded-lg border bg-background px-3"
        />
        <input
          aria-label="HTTPS endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://server.example/mcp"
          className="h-10 rounded-lg border bg-background px-3"
        />
        <button
          disabled={!name.trim() || !endpoint.trim()}
          onClick={add}
          className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-40"
        >
          Add unverified draft
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {servers.map((server) => (
          <li key={server.id} className="flex items-center gap-3 rounded-xl border p-3">
            <Cable className="h-4 w-4" />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{server.name}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {server.endpoint}
              </span>
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs">Unverified</span>
            <button
              onClick={() => {
                const next = servers.filter((item) => item.id !== server.id);
                setServers(next);
                saveOmega(scope, "mcp", next);
              }}
              className="p-2 text-xs"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {!servers.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No server drafts. Installation, diagnostics, health, updates, and permissions activate
          only after backend discovery verifies a manifest.
        </p>
      ) : null}
    </section>
  );
}

function ProviderPanel() {
  const providers = providerAdapters.list();
  return (
    <section aria-labelledby="provider-title">
      <h2 id="provider-title" className="text-lg font-semibold">
        Provider management
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        AI, image, search, and research adapters register through one typed platform contract.
      </p>
      {providers.length ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <li key={`${provider.kind}:${provider.id}`} className="rounded-xl border p-4">
              <strong>{provider.id}</strong>
              <p className="text-xs capitalize text-muted-foreground">
                {provider.kind} · {provider.capabilities.join(", ")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">{unavailable("Dynamic provider")}</div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Existing production models continue through the server provider registry. This surface never
        exposes credentials or permits browser-side provider secrets.
      </p>
    </section>
  );
}

function AgentPanel({ scope }: { scope: string }) {
  const [agents, setAgents] = useState<AgentDefinition[]>(() => loadOmega(scope, "agents", []));
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const add = () => {
    const next = [
      ...agents,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        prompt: prompt.trim(),
        tools: [],
        memory: false,
        fileIds: [],
        contextPackIds: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    ];
    setAgents(next);
    saveOmega(scope, "agents", next);
    setName("");
    setPrompt("");
  };
  return (
    <section aria-labelledby="agent-title">
      <h2 id="agent-title" className="text-lg font-semibold">
        Agent Studio
      </h2>
      <div className="mt-3">{unavailable("Agent execution")}</div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input
          aria-label="Agent name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name"
          className="h-10 rounded-lg border bg-background px-3"
        />
        <input
          aria-label="Agent instructions"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Instructions"
          className="h-10 rounded-lg border bg-background px-3"
        />
        <button
          disabled={!name.trim() || !prompt.trim()}
          onClick={add}
          className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-40"
        >
          Save draft
        </button>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => (
          <li key={agent.id} className="rounded-xl border p-4">
            <strong>{agent.name}</strong>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.prompt}</p>
            <p className="mt-2 text-xs">Version {agent.version} · Not executed</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const nodeTypes: PipelineNode["type"][] = [
  "agent",
  "condition",
  "tool",
  "memory",
  "context",
  "schedule",
];
function PipelinePanel({ scope }: { scope: string }) {
  const [pipeline, setPipeline] = useState<PipelineDefinition>(() =>
    loadOmega(scope, "pipeline", emptyPipeline()),
  );
  const result = useMemo(() => simulatePipeline(pipeline), [pipeline]);
  const add = (type: PipelineNode["type"]) => {
    const node = {
      id: crypto.randomUUID(),
      type,
      label: `${type} step`,
      requiresBackend: ["agent", "tool", "schedule"].includes(type),
    };
    const previous = pipeline.nodes.at(-2) ?? pipeline.nodes[0];
    const output = pipeline.nodes.at(-1)!;
    const next = {
      ...pipeline,
      nodes: [...pipeline.nodes.slice(0, -1), node, output],
      edges: [
        ...pipeline.edges.filter((edge) => edge.to !== output.id),
        { from: previous.id, to: node.id },
        { from: node.id, to: output.id },
      ],
    };
    setPipeline(next);
    saveOmega(scope, "pipeline", next);
  };
  return (
    <section aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" className="text-lg font-semibold">
        Universal AI Pipeline Builder
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Build and simulate dependency structure without executing tools or background agents.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {nodeTypes.map((type) => (
          <button
            key={type}
            onClick={() => add(type)}
            className="min-h-10 rounded-lg border px-3 text-xs hover:bg-accent"
          >
            Add {type}
          </button>
        ))}
      </div>
      <ol className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {pipeline.nodes.map((node, index) => (
          <li key={node.id} className="min-w-36 rounded-xl border p-3">
            <span className="text-xs uppercase text-muted-foreground">{node.type}</span>
            <strong className="mt-1 block text-sm">{node.label}</strong>
            {node.requiresBackend ? (
              <span className="mt-2 block text-[11px] text-amber-600">Backend required</span>
            ) : null}
            {index < pipeline.nodes.length - 1 ? <span className="sr-only">then</span> : null}
          </li>
        ))}
      </ol>
      <div
        className={`rounded-xl border p-4 ${result.valid ? "border-emerald-500/30" : "border-destructive/30"}`}
      >
        <h3 className="font-medium">Workspace Simulator</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Validation: {result.valid ? "Graph is structurally valid" : result.errors.join("; ")}
        </p>
        <p className="mt-2 text-xs">Order: {result.order.join(" → ") || "Unavailable"}</p>
        <p className="mt-1 text-xs">
          Blocked execution nodes:{" "}
          {result.backendRequired.length ? result.backendRequired.length : "None"}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Simulation validates topology and backend requirements only. It never fabricates outputs
          or claims execution.
        </p>
      </div>
    </section>
  );
}
