import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Clock3, Network, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  listKnowledgeGraph,
  type KnowledgeEdge,
  type KnowledgeNode,
  type KnowledgeSource,
} from "@/lib/professional.functions";
import { chatStoragePrincipal, savePendingActive } from "@/lib/chat-store";
import { useAccountConversationHistory } from "@/lib/use-account-conversation-history";
import { mergeKnowledgeHistoryNodes } from "@/lib/knowledge-history-nodes";

export const Route = createFileRoute("/knowledge-graph")({
  component: KnowledgeGraph,
  head: () => ({
    meta: [{ title: "KovaGPT Graph" }, { name: "robots", content: "noindex" }],
  }),
});
const colors = {
  project: "#8b5cf6",
  chat: "#3b82f6",
  file: "#14b8a6",
  artifact: "#f59e0b",
  memory: "#ec4899",
  context: "#22c55e",
};
const EMPTY_KNOWLEDGE_NODES: KnowledgeNode[] = [];
const EMPTY_KNOWLEDGE_EDGES: KnowledgeEdge[] = [];

function KnowledgeGraph() {
  const { isLoaded, user } = useUser();
  return <KnowledgeGraphForAccount key={isLoaded ? (user?.id ?? "guest") : "loading"} />;
}
function KnowledgeGraphForAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const list = useServerFn(listKnowledgeGraph);
  const [requestedCursors, setRequestedCursors] = useState<
    Partial<Record<KnowledgeSource, string | null>>
  >({});
  const [localPage, setLocalPage] = useState(0);
  const conversations = useAccountConversationHistory(userKey, isLoaded && Boolean(isSignedIn));
  const localHasNext = conversations.length > (localPage + 1) * 20;
  const [loadedCursors, setLoadedCursors] = useState<
    Partial<Record<KnowledgeSource, string | null>>
  >({});
  const [nextCursors, setNextCursors] = useState<Partial<Record<KnowledgeSource, string | null>>>(
    {},
  );
  const [graphState, setGraphState] = useState<{
    principal: string | null;
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
  }>({ principal: null, nodes: [], edges: [] });
  const nodes = useMemo(
    () =>
      principal !== null && graphState.principal === principal
        ? mergeKnowledgeHistoryNodes(graphState.nodes, conversations, localPage)
        : EMPTY_KNOWLEDGE_NODES,
    [principal, graphState, conversations, localPage],
  );
  const edges =
    principal !== null && graphState.principal === principal
      ? graphState.edges
      : EMPTY_KNOWLEDGE_EDGES;
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [kinds, setKinds] = useState<KnowledgeNode["kind"][]>([
      "project",
      "chat",
      "file",
      "artifact",
      "memory",
      "context",
    ]),
    [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"graph" | "timeline">("graph");
  useEffect(() => {
    if (!isLoaded || principal === null) {
      setGraphState({ principal: null, nodes: [], edges: [] });
      setLoading(true);
      setError(null);
      return;
    }
    if (!isSignedIn) {
      setGraphState({ principal, nodes: [], edges: [] });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    list({ data: { cursors: requestedCursors }, signal: controller.signal })
      .then((graph) => {
        if (cancelled) return;
        setLoadedCursors(requestedCursors);
        setNextCursors(graph.cursors);
        setSelected(null);
        setGraphState({ principal, nodes: graph.nodes, edges: graph.edges });
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Knowledge graph could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isLoaded, isSignedIn, list, principal, userKey, requestedCursors, localPage]);
  const visible = useMemo(
    () =>
      nodes.filter(
        (node) =>
          kinds.includes(node.kind) && node.label.toLowerCase().includes(query.toLowerCase()),
      ),
    [nodes, kinds, query],
  );
  const visibleEdges = useMemo(() => {
    const ids = new Set(visible.map((node) => node.id));
    return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }, [visible, edges]);
  const positioned = useMemo(
    () =>
      visible.map((node, index) => {
        const angle = (index / Math.max(visible.length, 1)) * Math.PI * 2;
        const ring = 140 + (index % 3) * 55;
        return { ...node, x: 400 + Math.cos(angle) * ring, y: 300 + Math.sin(angle) * ring };
      }),
    [visible],
  );
  const positions = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="kova-workspace-controls mx-auto min-w-0 w-full max-w-7xl px-4 py-7 sm:px-6"
      >
        <header>
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Knowledge Graph</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore explicit relationships among your authorized Projects, chats, files, artifacts,
            memories, and Context Packs.
          </p>
        </header>
        {isSignedIn && (
          <section className="mt-4 space-y-2" aria-label="Knowledge source pages">
            <p className="text-sm text-muted-foreground">
              This view contains one page per source. Search, timeline and relationships cover only
              loaded records; an absent link does not establish that no relationship exists.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["projects", "chats", "files", "library", "memories", "packs"] as const).map(
                (source) => (
                  <span key={source} className="inline-flex gap-1">
                    <button
                      type="button"
                      disabled={loading}
                      className="min-h-11 rounded-lg border px-3 text-sm"
                      onClick={() => setRequestedCursors({ ...loadedCursors, [source]: null })}
                    >
                      First {source} page
                    </button>
                    <button
                      type="button"
                      disabled={loading || !nextCursors[source]}
                      className="min-h-11 rounded-lg border px-3 text-sm"
                      onClick={() =>
                        setRequestedCursors({ ...loadedCursors, [source]: nextCursors[source] })
                      }
                    >
                      Next {source} page
                    </button>
                  </span>
                ),
              )}
              <button
                type="button"
                disabled={loading || localPage === 0}
                className="min-h-11 rounded-lg border px-3 text-sm"
                onClick={() => setLocalPage((page) => Math.max(0, page - 1))}
              >
                Previous local chats
              </button>
              <button
                type="button"
                disabled={loading || !localHasNext}
                className="min-h-11 rounded-lg border px-3 text-sm"
                onClick={() => setLocalPage((page) => page + 1)}
              >
                Next local chats
              </button>
            </div>
          </section>
        )}
        {error && nodes.length > 0 && (
          <p role="alert" className="mt-3 text-sm">
            {error}. Last loaded graph retained; retry the page action.
          </p>
        )}
        <div className="my-5 flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search knowledge graph</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-xl border bg-background pl-9"
              placeholder="Search graph"
            />
          </label>
          <div
            className="kova-graph-filters flex gap-1 overflow-x-auto"
            aria-label="Knowledge types"
          >
            <button
              onClick={() => setMode("graph")}
              aria-pressed={mode === "graph"}
              className={`kova-graph-mode min-h-10 rounded-lg border px-3 text-sm ${mode === "graph" ? "bg-foreground text-background" : ""}`}
            >
              <Network className="mr-1 inline h-4 w-4" />
              Graph
            </button>
            <button
              onClick={() => setMode("timeline")}
              aria-pressed={mode === "timeline"}
              className={`kova-graph-mode min-h-10 rounded-lg border px-3 text-sm ${mode === "timeline" ? "bg-foreground text-background" : ""}`}
            >
              <Clock3 className="mr-1 inline h-4 w-4" />
              Timeline
            </button>
            {Object.keys(colors).map((kind) => (
              <button
                key={kind}
                aria-pressed={kinds.includes(kind as KnowledgeNode["kind"])}
                onClick={() =>
                  setKinds((all) =>
                    all.includes(kind as KnowledgeNode["kind"])
                      ? all.filter((value) => value !== kind)
                      : [...all, kind as KnowledgeNode["kind"]],
                  )
                }
                className={`min-h-10 shrink-0 rounded-lg border px-3 text-sm capitalize ${kinds.includes(kind as KnowledgeNode["kind"]) ? "bg-foreground text-background" : ""}`}
              >
                {kind}
              </button>
            ))}
          </div>
        </div>
        {!isSignedIn && !loading ? (
          <div className="rounded-2xl border p-10 text-center">
            Sign in to build your authorized Knowledge Graph.
          </div>
        ) : loading ? (
          <div
            aria-label="Loading knowledge graph"
            className="h-[32rem] animate-pulse rounded-2xl bg-muted"
          />
        ) : error && nodes.length === 0 ? (
          <div role="alert" className="rounded-xl border border-destructive/40 p-4">
            <p>{error}</p>
            <button
              onClick={() => setRequestedCursors({ ...requestedCursors })}
              className="mt-3 min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center">
            <Network className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No connected knowledge on loaded pages</h2>
            <p className="text-sm text-muted-foreground">
              Browse another source page, adjust filters or add Projects, files, memories, and
              Context Packs.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => {
                  setQuery("");
                  setKinds(Object.keys(colors) as KnowledgeNode["kind"][]);
                }}
                className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
              >
                Reset filters
              </button>
              <Link
                to="/projects"
                className="min-h-10 rounded-lg bg-foreground px-3 py-2 text-sm text-background"
              >
                Open Projects
              </Link>
            </div>
          </div>
        ) : mode === "timeline" ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <ol
              className="min-w-0 divide-y rounded-2xl border bg-card/30"
              aria-label="Knowledge timeline"
            >
              {[...visible]
                .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
                .map((node) => {
                  const related = visibleEdges.filter(
                    (edge) => edge.source === node.id || edge.target === node.id,
                  );
                  return (
                    <li key={node.id} className="flex min-h-16 items-center gap-3 p-3">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: colors[node.kind] }}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={node.href}
                          className="kova-graph-resource block whitespace-normal [overflow-wrap:anywhere] font-medium hover:underline"
                        >
                          {node.label}
                        </Link>
                        <p className="text-xs capitalize text-muted-foreground">
                          {node.kind} · {new Date(node.updatedAt).toLocaleString()} ·{" "}
                          {related.length} relationships
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs">
                        Strength {related.reduce((sum, edge) => sum + edge.strength, 0)}
                      </span>
                    </li>
                  );
                })}
            </ol>
            <aside className="min-w-0 rounded-2xl border p-4">
              <h2 className="font-semibold">Relationship clusters</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Clusters use explicit Project membership and Context Pack inclusion only.
              </p>
              <ul className="mt-3 space-y-2">
                {[...new Set(visible.map((node) => node.projectId).filter(Boolean))].map(
                  (projectId) => {
                    const members = visible.filter((node) => node.projectId === projectId);
                    const project = nodes.find((node) => node.id === `project:${projectId}`);
                    return (
                      <li key={projectId} className="rounded-xl border p-3">
                        <Link
                          to={project?.href ?? "/projects"}
                          className="kova-graph-resource block whitespace-normal [overflow-wrap:anywhere] text-sm font-medium hover:underline"
                        >
                          {project?.label ?? "Project cluster"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {members.length} connected resources
                        </p>
                      </li>
                    );
                  },
                )}
              </ul>
            </aside>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="overflow-x-auto rounded-2xl border bg-card/30">
              <svg
                viewBox="0 0 800 600"
                className="min-h-[34rem] min-w-[720px] w-full"
                role="img"
                aria-label={`Knowledge graph with ${visible.length} nodes and ${visibleEdges.length} relationships`}
              >
                {visibleEdges.map((edge, index) => {
                  const a = positions.get(edge.source),
                    b = positions.get(edge.target);
                  return a && b ? (
                    <line
                      key={`${edge.source}:${edge.target}:${index}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="currentColor"
                      strokeOpacity=".16"
                      strokeWidth={Math.min(4, edge.strength)}
                    >
                      <title>{edge.reason}</title>
                    </line>
                  ) : null;
                })}
                {positioned.map((node) => (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.kind}: ${node.label}`}
                    onClick={() => setSelected(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelected(node.id);
                    }}
                    className="cursor-pointer outline-none"
                  >
                    <rect
                      className="kova-graph-node-hit"
                      x={node.x - 25}
                      y={node.y - 25}
                      width={50}
                      height={50}
                      fill="transparent"
                      aria-hidden="true"
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={selected === node.id ? 13 : 9}
                      fill={colors[node.kind]}
                      stroke="white"
                      strokeWidth={selected === node.id ? 3 : 1.5}
                    />
                    <text
                      x={node.x}
                      y={node.y + 24}
                      textAnchor="middle"
                      fontSize="11"
                      fill="currentColor"
                    >
                      {node.label.slice(0, 24)}
                    </text>
                    <title>{node.label}</title>
                  </g>
                ))}
              </svg>
            </div>
            <aside className="rounded-2xl border p-4">
              <h2 className="font-semibold">Selected knowledge</h2>
              {selected && positions.get(selected) ? (
                <div className="mt-3">
                  <span className="text-xs uppercase text-muted-foreground">
                    {positions.get(selected)?.kind}
                  </span>
                  <h3 className="mt-1 font-medium">{positions.get(selected)?.label}</h3>
                  <Link
                    to={positions.get(selected)!.href}
                    onClick={() => {
                      const node = positions.get(selected);
                      if (node?.id.startsWith("local-chat:")) {
                        try {
                          savePendingActive(userKey, node.id.replace("local-chat:", ""));
                        } catch {
                          // Navigation still works when browser storage is unavailable.
                        }
                      }
                    }}
                    className="kova-workspace-action mt-4 inline-flex min-h-10 items-center rounded-lg bg-foreground px-3 text-sm text-background"
                  >
                    Open resource
                  </Link>
                  <h4 className="mt-5 text-sm font-medium">Relationships</h4>
                  <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                    {visibleEdges
                      .filter((edge) => edge.source === selected || edge.target === selected)
                      .map((edge, index) => (
                        <li key={index}>
                          {edge.reason} · strength {edge.strength}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a node to inspect its explicit relationships.
                </p>
              )}
            </aside>
          </div>
        )}
      </main>
    </AppShell>
  );
}
