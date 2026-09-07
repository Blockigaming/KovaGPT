import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  BarChart3,
  Bot,
  Building2,
  Cable,
  Copy,
  Download,
  History,
  Pencil,
  Upload,
  GitBranch,
  Network,
  ServerCog,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import { platformEvents } from "@/platform/events";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import {
  emptyPipeline,
  loadOmega,
  saveOmega,
  type EnterpriseDraft,
  type McpDraft,
} from "@/lib/omega-store";
import {
  archiveSavedAgent,
  createSavedAgent,
  duplicateSavedAgent,
  importSavedAgent,
  listSavedAgents,
  type SavedAgent,
} from "@/lib/agent-definitions.functions";
import {
  exportAgent,
  parseAgentImport,
  safeAgentFilename,
  type PortableAgent,
} from "@/lib/agent-portability";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  canTransitionAgent,
  simulatePipeline,
  type AgentRunState,
  type PipelineDefinition,
  type PipelineNode,
} from "@/platform/omega";
import { providerAdapters } from "@/platform/providers";
import { OperationalState } from "@/components/OperationalState";
import { capabilityState, useReadiness } from "@/lib/readiness-client";

export const Route = createFileRoute("/omega")({
  component: OmegaPage,
  head: () => ({
    meta: [{ title: "KovaGPT Control" }, { name: "robots", content: "noindex" }],
  }),
});
type Tab =
  "collaboration" | "execution" | "enterprise" | "mcp" | "providers" | "agents" | "pipelines";
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
const AgentDefinitionDialog = lazy(() =>
  import("@/components/AgentDefinitionDialog").then((module) => ({
    default: module.AgentDefinitionDialog,
  })),
);
const AgentAnalyticsDialog = lazy(() =>
  import("@/components/AgentAnalyticsDialog").then((module) => ({
    default: module.AgentAnalyticsDialog,
  })),
);

function OmegaPage() {
  const { readiness, refresh } = useReadiness();
  const runnerState = capabilityState(readiness, "agentRunner");
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
          <SignInButton mode="modal">
            <button className="mt-5 min-h-11 rounded-full bg-foreground px-5 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Sign in to Omega
            </button>
          </SignInButton>
        </main>
      </AppShell>
    );
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={Bot}
          title="Omega Control Center"
          description="Account-scoped agents, provider health, execution controls, and backend-ready orchestration surfaces."
        />
        <OperationalState
          state={runnerState === "unavailable" ? "runner-unavailable" : runnerState}
          onRetry={refresh}
        />
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
          <AgentPanel />
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
      <a
        href="/organization"
        className="mt-3 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm hover:bg-accent"
      >
        Open organization administration
      </a>
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

function AgentPanel() {
  const listAgents = useServerFn(listSavedAgents),
    createAgent = useServerFn(createSavedAgent),
    duplicateAgent = useServerFn(duplicateSavedAgent),
    archiveAgent = useServerFn(archiveSavedAgent),
    importAgent = useServerFn(importSavedAgent);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<SavedAgent | null>(null);
  const [dialogMode, setDialogMode] = useState<"edit" | "history" | null>(null);
  const [analyticsAgent, setAnalyticsAgent] = useState<SavedAgent | null>(null);
  const [importPreview, setImportPreview] = useState<PortableAgent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [runs, setRuns] = useState<
    { id: string; status: string; created_at: string; updated_at: string; usage?: unknown }[]
  >([]);
  useEffect(() => {
    Promise.all([
      listAgents({}),
      authFetch("/api/agents/runs").then(async (response) => {
        if (!response.ok) return [];
        const payload = (await response.json()) as { runs?: typeof runs };
        return payload.runs ?? [];
      }),
    ])
      .then(([saved, history]) => {
        setAgents(saved);
        setRuns(history);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Agents unavailable"))
      .finally(() => setLoading(false));
  }, [listAgents]);
  const completedRuns = runs.filter((run) => run.status === "completed");
  const averageRuntime = completedRuns.length
    ? Math.round(
        completedRuns.reduce(
          (total, run) =>
            total + Math.max(0, Date.parse(run.updated_at) - Date.parse(run.created_at)),
          0,
        ) /
          completedRuns.length /
          1000,
      )
    : null;
  const add = async () => {
    setSaving(true);
    try {
      const created = await createAgent({
        data: { name, instructions: prompt, allowedTools: [], memoryEnabled: false },
      });
      setAgents((current) => [created, ...current]);
      setName("");
      setPrompt("");
      toast.success("Agent saved to your account");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent could not be saved");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-labelledby="agent-title">
      <h2 id="agent-title" className="text-lg font-semibold">
        Agent Studio
      </h2>
      <div className="mt-3">{unavailable("Agent execution")}</div>
      <p className="mt-3 text-sm text-muted-foreground">
        Saved agents are reusable account-scoped instruction profiles. Execution remains separate
        and is available only when the authenticated runner and plan entitlement are healthy.
      </p>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Agent execution analytics">
        <div className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">Recent executions</dt>
          <dd className="mt-1 text-lg font-semibold">{runs.length}</dd>
        </div>
        <div className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">Completed</dt>
          <dd className="mt-1 text-lg font-semibold">{completedRuns.length}</dd>
        </div>
        <div className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">Average completed runtime</dt>
          <dd className="mt-1 text-lg font-semibold">
            {averageRuntime === null ? "No data" : `${averageRuntime}s`}
          </dd>
        </div>
      </dl>
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
          disabled={saving || !name.trim() || !prompt.trim()}
          onClick={() => void add()}
          className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save agent"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="min-h-10 rounded-lg border px-3 text-sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 inline h-4 w-4" />
          Import agent
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import agent file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              setImportPreview(parseAgentImport(await file.text()));
            } catch {
              toast.error("This is not a valid KovaGPT agent file");
            }
          }}
        />
        <p className="self-center text-xs text-muted-foreground">
          Imported tools and memory are disabled until you review and save them.
        </p>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {loading ? (
          <li
            className="h-28 animate-pulse rounded-xl bg-muted"
            aria-label="Loading saved agents"
          />
        ) : agents.length === 0 ? (
          <li className="rounded-xl border p-5 text-sm text-muted-foreground">
            No saved agents. Create one above without granting tools or execution permissions.
          </li>
        ) : (
          agents.map((agent) => (
            <li key={agent.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-2">
                <strong className="truncate">{agent.name}</strong>
                <span className="text-xs text-muted-foreground">v{agent.version}</span>
              </div>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                {agent.instructions}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {agent.project_id ? "Project scoped" : "Account scoped"} · Updated{" "}
                {new Date(agent.updated_at).toLocaleDateString()}
              </p>
              <div className="mt-3 flex gap-1">
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`Analytics for ${agent.name}`}
                  onClick={() => setAnalyticsAgent(agent)}
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`Edit ${agent.name}`}
                  onClick={() => {
                    setSelected(agent);
                    setDialogMode("edit");
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`Version history for ${agent.name}`}
                  onClick={() => {
                    setSelected(agent);
                    setDialogMode("history");
                  }}
                >
                  <History className="h-4 w-4" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`Export ${agent.name}`}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(exportAgent(agent), null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = safeAgentFilename(agent.name);
                    anchor.click();
                    URL.revokeObjectURL(url);
                    platformEvents.publish("platform", "agent.exported", {
                      sourceVersion: agent.version,
                    });
                    toast.success("Agent exported without secrets or execution history");
                  }}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`Duplicate ${agent.name}`}
                  onClick={async () => {
                    try {
                      const copy = await duplicateAgent({ data: { id: agent.id } });
                      setAgents((current) => [copy, ...current]);
                      toast.success("Agent duplicated");
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Agent could not be duplicated",
                      );
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
                  aria-label={`${agent.archived_at ? "Restore" : "Archive"} ${agent.name}`}
                  onClick={async () => {
                    const archived = !agent.archived_at;
                    try {
                      await archiveAgent({ data: { id: agent.id, archived } });
                      setAgents((current) =>
                        current.map((item) =>
                          item.id === agent.id
                            ? { ...item, archived_at: archived ? new Date().toISOString() : null }
                            : item,
                        ),
                      );
                      toast.success(archived ? "Agent archived" : "Agent restored");
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Agent could not be updated",
                      );
                    }
                  }}
                >
                  {agent.archived_at ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      {selected && dialogMode ? (
        <Suspense
          fallback={
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Loading agent editor…
            </p>
          }
        >
          <AgentDefinitionDialog
            agent={selected}
            mode={dialogMode}
            onClose={() => {
              setSelected(null);
              setDialogMode(null);
            }}
            onSaved={(saved) => {
              setAgents((items) => items.map((item) => (item.id === saved.id ? saved : item)));
              setSelected(saved);
            }}
          />
        </Suspense>
      ) : null}
      {analyticsAgent ? (
        <Suspense fallback={<p role="status">Loading analytics…</p>}>
          <AgentAnalyticsDialog agent={analyticsAgent} onClose={() => setAnalyticsAgent(null)} />
        </Suspense>
      ) : null}
      <ConfirmActionDialog
        open={Boolean(importPreview)}
        onOpenChange={(open) => !open && setImportPreview(null)}
        title={`Import ${importPreview?.name ?? "agent"}?`}
        description="A private copy will be created. Imported tool permissions and memory are disabled for safety."
        confirmLabel="Import private copy"
        disabled={saving}
        onConfirm={async () => {
          if (!importPreview) return;
          setSaving(true);
          try {
            const created = await importAgent({ data: importPreview });
            setAgents((items) => [created, ...items]);
            platformEvents.publish("platform", "agent.imported", {
              sourceVersion: importPreview.sourceVersion,
            });
            toast.success("Agent imported safely");
            setImportPreview(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Agent could not be imported");
          } finally {
            setSaving(false);
          }
        }}
      />
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
