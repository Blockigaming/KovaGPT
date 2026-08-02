import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Clock3, Network, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  listKnowledgeGraph,
  type KnowledgeEdge,
  type KnowledgeNode,
} from "@/lib/professional.functions";
import { loadConversations } from "@/lib/chat-store";
import {
  decideKnowledgeRelationship,
  listKnowledgeRelationships,
} from "@/lib/knowledge-provenance.functions";
export const Route = createFileRoute("/knowledge-graph")({
  component: KnowledgeGraph,
  head: () => ({
    meta: [{ title: "Knowledge Graph | KovaGPT" }, { name: "robots", content: "noindex" }],
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
function KnowledgeGraph() {
  const { isLoaded, isSignedIn } = useUser();
  const list = useServerFn(listKnowledgeGraph);
  const listProvenance = useServerFn(listKnowledgeRelationships);
  const decideProvenance = useServerFn(decideKnowledgeRelationship);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]),
    [edges, setEdges] = useState<KnowledgeEdge[]>([]),
    [loading, setLoading] = useState(true),
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
  const [provenance, setProvenance] = useState<Record<string, unknown>[]>([]);
  const [mode, setMode] = useState<"graph" | "timeline">("graph");
  useEffect(() => {
    if (!selected?.startsWith("project:")) {
      setProvenance([]);
      return;
    }
    listProvenance({ data: { type: "project", id: selected.slice(8) } })
      .then((rows) => setProvenance(rows as Record<string, unknown>[]))
      .catch(() => setProvenance([]));
  }, [selected, listProvenance]);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    list({})
      .then((graph) => {
        const local = loadConversations().map((chat) => ({
          id: `local-chat:${chat.id}`,
          kind: "chat" as const,
          label: chat.title,
          href: `/?chat=${chat.id}`,
          updatedAt: new Date(chat.updatedAt).toISOString(),
        }));
        setNodes([...graph.nodes, ...local]);
        setEdges(graph.edges);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Knowledge graph could not be loaded"),
      )
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list]);
  const visible = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            kinds.includes(node.kind) && node.label.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 120),
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
      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6">
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
          <div className="flex gap-1 overflow-x-auto" aria-label="Knowledge types">
            <button
              onClick={() => setMode("graph")}
              aria-pressed={mode === "graph"}
              className={`min-h-10 rounded-lg border px-3 text-sm ${mode === "graph" ? "bg-foreground text-background" : ""}`}
            >
              <Network className="mr-1 inline h-4 w-4" />
              Graph
            </button>
            <button
              onClick={() => setMode("timeline")}
              aria-pressed={mode === "timeline"}
              className={`min-h-10 rounded-lg border px-3 text-sm ${mode === "timeline" ? "bg-foreground text-background" : ""}`}
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
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 p-4">
            <p>{error}</p>
            <button
              onClick={() => location.reload()}
              className="mt-3 min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center">
            <Network className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No connected knowledge found</h2>
            <p className="text-sm text-muted-foreground">
              Adjust filters or add Projects, files, memories, and Context Packs.
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
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <ol className="divide-y rounded-2xl border bg-card/30" aria-label="Knowledge timeline">
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
                        <Link to={node.href} className="truncate font-medium hover:underline">
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
            <aside className="rounded-2xl border p-4">
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
                          className="text-sm font-medium hover:underline"
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
                      if (node?.id.startsWith("local-chat:"))
                        localStorage.setItem(
                          "nova-gpt-pending-active",
                          node.id.replace("local-chat:", ""),
                        );
                    }}
                    className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-foreground px-3 text-sm text-background"
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
                  <h4 className="mt-5 text-sm font-medium">Why is this remembered?</h4>
                  {provenance.length ? (
                    <ul className="mt-2 space-y-2" aria-label="Knowledge provenance">
                      {provenance.map((row) => (
                        <li key={String(row.id)} className="rounded-lg border p-2 text-xs">
                          <p>
                            <strong>{String(row.relationship_type)}</strong> ·{" "}
                            {String(row.derivation_method)} · confidence{" "}
                            {Math.round(Number(row.confidence) * 100)}%
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            Created {new Date(String(row.created_at)).toLocaleString()}
                          </p>
                          {row.derivation_method === "model-suggested" &&
                          !row.approved_at &&
                          !row.rejected_at ? (
                            <div className="mt-2 flex gap-2">
                              <button
                                className="min-h-10 rounded-lg border px-2"
                                onClick={async () => {
                                  try {
                                    await decideProvenance({
                                      data: { id: String(row.id), decision: "approve" },
                                    });
                                    setProvenance((all) =>
                                      all.map((item) =>
                                        item.id === row.id
                                          ? { ...item, approved_at: new Date().toISOString() }
                                          : item,
                                      ),
                                    );
                                    toast.success("Knowledge link approved");
                                  } catch (error) {
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Knowledge link could not be approved",
                                    );
                                  }
                                }}
                              >
                                Approve link
                              </button>
                              <button
                                className="min-h-10 rounded-lg border px-2"
                                onClick={async () => {
                                  try {
                                    await decideProvenance({
                                      data: { id: String(row.id), decision: "reject" },
                                    });
                                    setProvenance((all) =>
                                      all.map((item) =>
                                        item.id === row.id
                                          ? { ...item, rejected_at: new Date().toISOString() }
                                          : item,
                                      ),
                                    );
                                    toast.success("Knowledge link rejected");
                                  } catch (error) {
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Knowledge link could not be rejected",
                                    );
                                  }
                                }}
                              >
                                Reject link
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No persisted provenance links explain this resource yet.
                    </p>
                  )}
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
