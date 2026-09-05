import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import {
  KOVA_MODES,
  KOVA_TOOLS,
  KOVA_APPS,
  normalizeKovaConfig,
  kovaId,
  type KovaConfig,
} from "@/lib/custom-kovas-policy.mjs";
import {
  requestKovas,
  newKovaLinkToken,
  type KovaCard,
  type KovaView,
  type KovaVersion,
} from "@/lib/custom-kovas-client";
import {
  loadConversations,
  saveConversations,
  savePendingActive,
  saveDraft,
  type Conversation,
} from "@/lib/chat-store";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
} from "@/lib/principal-browser-storage.mjs";
const Preview = lazy(() => import("@/components/CustomKovaPreview"));
export const Route = createFileRoute("/kovas")({
  validateSearch: (raw: Record<string, unknown>) => {
    try {
      return { id: raw.id ? kovaId(raw.id) : undefined };
    } catch {
      return { id: undefined };
    }
  },
  component: KovasPage,
  head: () => ({
    meta: [
      { title: "Custom Kovas | KovaGPT" },
      {
        name: "description",
        content:
          "Create private conversational Kovas, try saved versions, and discover community publications.",
      },
    ],
  }),
});
function KovasPage() {
  const { isLoaded, user } = useUser();
  const { id } = Route.useSearch();
  return (
    <AppShell>
      {isLoaded ? (
        <Workspace key={user?.id ?? "guest"} ownerId={user?.id ?? null} initialId={id} />
      ) : (
        <p role="status">Loading account…</p>
      )}
    </AppShell>
  );
}
const empty = () =>
  normalizeKovaConfig({
    name: "My Kova",
    icon: "✦",
    description: "",
    instructions: "Help the user with their task.",
    mode: "medium",
    starters: [],
    tools: [],
    apps: [],
    knowledge: [],
    allowFork: false,
  });
type Mutation = {
  requestedAt: string;
  id: string | null;
  mutationId: string;
  revision: number;
  action: string;
  payload: Record<string, unknown>;
};
function Workspace({ ownerId, initialId }: { ownerId: string | null; initialId?: string }) {
  const navigate = useNavigate();
  const [cards, setCards] = useState<KovaCard[]>([]),
    [scope, setScope] = useState<"owned" | "directory">(ownerId ? "owned" : "directory"),
    [query, setQuery] = useState(""),
    [next, setNext] = useState<string | null>(null);
  const [view, setView] = useState<KovaView | null>(null),
    [config, setConfig] = useState<KovaConfig>(empty),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [versions, setVersions] = useState<KovaVersion[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [closed, setClosed] = useState(false),
    [retry, setRetry] = useState<Mutation | null>(null),
    [preview, setPreview] = useState(false),
    [inspected, setInspected] = useState<KovaView | null>(null),
    [consent, setConsent] = useState(false),
    [link, setLink] = useState("");
  const [library, setLibrary] = useState<{ id: string; title: string; characters: number }[]>([]),
    [libraryAfter, setLibraryAfter] = useState<string | null>(null),
    [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const lifetime = useRef(new AbortController()),
    generation = useRef(0),
    selection = useRef(initialId ?? null);
  const listGeneration = useRef(0);
  const alive = (epoch: number) => epoch === generation.current && !lifetime.current.signal.aborted;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const ownerGeneration = generation;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, ownerId)) return;
      ownerGeneration.current++;
      controller.abort();
      setClosed(true);
      setView(null);
      setCards([]);
      setConfig(empty());
      setVersions([]);
      setLibrary([]);
      setRetry(null);
      setLink("");
      setPreview(false);
      setInspected(null);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      ownerGeneration.current++;
      controller.abort();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [ownerId]);
  async function list(which = scope, after: string | null = null) {
    const listEpoch = ++listGeneration.current;
    const epoch = generation.current;
    setError("");
    try {
      const path =
        which === "directory"
          ? `/api/kovas/directory${after ? `?after=${after}` : ""}`
          : `/api/kovas?scope=owned${after ? `&after=${after}` : ""}`;
      const result = await requestKovas<{ rows: KovaCard[] }>(
        which === "directory" ? null : ownerId,
        path,
        lifetime.current.signal,
      );
      if (!alive(epoch) || listEpoch !== listGeneration.current) return;
      const rows = result.rows.slice(0, 20);
      setCards((old) =>
        after ? [...new Map([...old, ...rows].map((row) => [row.id, row])).values()] : rows,
      );
      setNext(result.rows.length > 20 ? (rows.at(-1)?.id ?? null) : null);
    } catch (e) {
      if (alive(epoch)) setError(e instanceof Error ? e.message : "Could not load Kovas.");
    }
  }
  async function select(id: string) {
    if (!ownerId) return;
    const epoch = ++generation.current;
    selection.current = id;
    setBusy(true);
    setError("");
    setView(null);
    setEditing(false);
    setPreview(false);
    setLink("");
    setConsent(false);
    setVersions([]);
    setRetry(null);
    setInspected(null);
    try {
      const result = await requestKovas<KovaView>(
        ownerId,
        `/api/kovas?scope=read&id=${id}`,
        lifetime.current.signal,
      );
      if (!alive(epoch) || selection.current !== id) return;
      setView(result);
      if (result.owned) {
        setConfig(normalizeKovaConfig(result.config));
        const history = await requestKovas<{ rows: KovaVersion[] }>(
          ownerId,
          `/api/kovas?scope=versions&id=${id}`,
          lifetime.current.signal,
        );
        if (!alive(epoch)) return;
        setVersions(history.rows);
      }
      setDirty(false);
    } catch (e) {
      if (alive(epoch)) setError(e instanceof Error ? e.message : "This Kova is unavailable.");
    } finally {
      if (alive(epoch)) setBusy(false);
    }
  }
  async function submit(action: string, payload: Record<string, unknown>, existing?: Mutation) {
    if (!ownerId || closed) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setPreview(false);
    const body = existing ?? {
      id: action === "create" ? null : (view?.id ?? null),
      mutationId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      revision: action === "create" ? 0 : (view?.revision ?? 0),
      action,
      payload,
    };
    try {
      const result = await requestKovas<{ id: string; deleted: boolean; revision: number }>(
        ownerId,
        "/api/kovas",
        lifetime.current.signal,
        body,
      );
      if (!alive(epoch)) return;
      setRetry(null);
      setConsent(false);
      setDirty(false);
      if (body.action === "claimLink")
        history.replaceState(null, "", location.pathname + location.search);
      if (result.deleted) {
        setView(null);
        setEditing(false);
        selection.current = null;
        await list();
      } else {
        const expected = generation.current + 1;
        await select(result.id);
        if (!alive(expected) || selection.current !== result.id) return;
        if (
          body.action === "publish" &&
          body.payload.visibility === "link" &&
          typeof body.payload.token === "string"
        )
          setLink(`${location.origin}/kovas?id=${result.id}#kova_key=${body.payload.token}`);
        await list();
      }
    } catch (e) {
      if (alive(epoch)) {
        setError(e instanceof Error ? e.message : "Request failed.");
        if (!("status" in Object(e)) || Number((e as { status?: number }).status) >= 500)
          setRetry(body);
      }
    } finally {
      if (alive(epoch)) setBusy(false);
    }
  }
  const loadScope = useEffectEvent((which: "owned" | "directory") => {
    void list(which);
  });
  useEffect(() => {
    loadScope(scope);
  }, [scope]); // Scope changes load a fresh ordered page.
  const openInitial = useEffectEvent(() => {
    if (!initialId || !ownerId) return;
    const token = new URLSearchParams(location.hash.slice(1)).get("kova_key");
    if (token)
      void submit(
        "claimLink",
        { token },
        {
          id: initialId,
          mutationId: crypto.randomUUID(),
          requestedAt: new Date().toISOString(),
          revision: 0,
          action: "claimLink",
          payload: { token },
        },
      );
    else void select(initialId);
  });
  useEffect(() => {
    openInitial();
  }, [initialId, ownerId]);
  async function inspectVersion(id: string) {
    if (!ownerId || !view) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await requestKovas<KovaView>(
        ownerId,
        `/api/kovas?scope=version&id=${view.id}&versionId=${id}`,
        lifetime.current.signal,
      );
      if (alive(epoch)) {
        setInspected(result);
        setPreview(false);
      }
    } catch (e) {
      if (alive(epoch)) setError(e instanceof Error ? e.message : "Version unavailable.");
    } finally {
      if (alive(epoch)) setBusy(false);
    }
  }
  function change(nextConfig: KovaConfig) {
    setConfig(nextConfig);
    setDirty(true);
    setConsent(false);
  }
  async function loadKnowledge(after: string | null = null) {
    if (!ownerId) return;
    const epoch = generation.current;
    setKnowledgeOpen(true);
    try {
      const result = await requestKovas<{ rows: typeof library }>(
        ownerId,
        `/api/kovas?scope=knowledge${after ? `&after=${after}` : ""}`,
        lifetime.current.signal,
      );
      if (!alive(epoch)) return;
      setLibrary((old) =>
        after ? [...old, ...result.rows.slice(0, 20)] : result.rows.slice(0, 20),
      );
      setLibraryAfter(result.rows.length > 20 ? result.rows[19].id : null);
    } catch (e) {
      if (alive(epoch)) setError(e instanceof Error ? e.message : "Knowledge files unavailable.");
    }
  }
  async function startChat(starter = "") {
    if (!ownerId || !view) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      const chat: Conversation = {
        id: crypto.randomUUID(),
        title: view.config.name,
        mode: view.config.mode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        kova: { id: view.id, versionId: view.versionId },
      };
      if (!(await saveConversations(ownerId, [chat, ...loadConversations(ownerId)])))
        throw Error("Chat history is not ready. Check chat sync and retry.");
      if (!alive(epoch)) return;
      savePendingActive(ownerId, chat.id);
      if (starter) saveDraft(ownerId, chat.id, starter);
      await navigate({ to: "/" });
    } catch (e) {
      if (alive(epoch)) setError(e instanceof Error ? e.message : "Could not start chat.");
    } finally {
      if (alive(epoch)) setBusy(false);
    }
  }
  if (closed) return <p role="status">Device data was cleared. Reload to open Kovas again.</p>;
  const disabled = busy || Boolean(retry);
  const filtered = cards.filter((c) =>
    `${c.config.name} ${c.config.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Custom Kovas</h1>
          <p className="text-sm text-muted-foreground">
            Your instructions, selected knowledge, and tools. Private until you publish.
          </p>
        </div>
        {ownerId ? (
          <button
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
            disabled={disabled}
            onClick={() => {
              generation.current++;
              selection.current = null;
              setView(null);
              setConfig(empty());
              setEditing(true);
              setDirty(true);
              setConsent(false);
              setPreview(false);
              setLink("");
              setVersions([]);
            }}
          >
            Create a Kova
          </button>
        ) : (
          <SignInButton mode="modal">
            <button className="rounded border px-3 py-2">Sign in to create or chat</button>
          </SignInButton>
        )}
      </header>
      {error && (
        <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {retry && (
        <p className="rounded border p-3 text-sm">
          The last request’s outcome is uncertain.{" "}
          <button
            className="underline"
            disabled={busy}
            onClick={() => void submit(retry.action, retry.payload, retry)}
          >
            Retry the same action
          </button>{" "}
          or{" "}
          <button
            className="underline"
            disabled={busy}
            onClick={() => {
              setRetry(null);
              if (retry.id) void select(retry.id);
              else void list();
            }}
          >
            refresh account state
          </button>{" "}
          before editing.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="underline"
          disabled={disabled || !ownerId}
          onClick={() => setScope("owned")}
        >
          My Kovas
        </button>
        <button className="underline" disabled={disabled} onClick={() => setScope("directory")}>
          Community directory
        </button>
        <label className="ml-auto text-sm">
          Search loaded Kovas{" "}
          <input
            className="rounded border bg-background px-2 py-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((card) => (
          <button
            key={card.id}
            className="rounded-xl border p-4 text-left"
            disabled={disabled || !ownerId}
            onClick={() => void select(card.id)}
          >
            <span aria-hidden="true" className="text-xl">
              {card.config.icon}
            </span>
            <strong className="ml-2">{card.config.name}</strong>
            <p className="mt-2 text-sm text-muted-foreground">{card.config.description}</p>
            <p className="mt-2 text-xs">
              {card.owned ? "Yours · " : ""}
              {card.visibility}
              {card.blocked ? " · Removed by moderation" : ""}
            </p>
          </button>
        ))}
      </div>
      {!cards.length && (
        <p className="text-sm text-muted-foreground">
          {scope === "owned"
            ? "No saved Kovas yet."
            : "No community Kovas are currently published."}
        </p>
      )}
      {next && (
        <button className="underline" disabled={disabled} onClick={() => void list(scope, next)}>
          Load more Kovas
        </button>
      )}
      {view && !editing && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-xl font-semibold">
            {view.config.icon} {view.config.name}
          </h2>
          <p>{view.config.description}</p>
          <p className="text-sm text-muted-foreground">
            Model mode: {view.config.mode}. Tools: {view.config.tools.join(", ") || "none"}. Apps:{" "}
            {view.config.apps.join(", ") || "none"}; only your own enabled accounts are available.
          </p>
          {view.blocked && (
            <p role="alert">
              This Kova is unavailable following moderation. Its owner can still inspect or edit it.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded bg-primary px-3 py-2 text-primary-foreground"
              disabled={disabled || view.blocked}
              onClick={() => void startChat()}
            >
              Start a chat
            </button>
            {view.config.starters.map((s, i) => (
              <button
                key={i}
                className="rounded border px-3 py-2 text-sm"
                disabled={disabled || view.blocked}
                onClick={() => void startChat(s)}
              >
                {s}
              </button>
            ))}
            {view.owned && (
              <button className="underline" disabled={disabled} onClick={() => setEditing(true)}>
                Edit Kova
              </button>
            )}
            <button
              className="underline"
              disabled={disabled || view.blocked || (!view.owned && !view.config.allowFork)}
              onClick={() => {
                if (
                  window.confirm(
                    "Create a private copy of this Kova and its shared knowledge in your account?",
                  )
                )
                  void submit("fork", {
                    consent: view.owned ? view.versionId : view.publicationVersion,
                  });
              }}
            >
              Create a private copy
            </button>
            {view.publicationVersion && (
              <button
                className="underline"
                disabled={disabled}
                onClick={() => {
                  const reason = window.prompt(
                    "What should moderators review? Do not include sensitive personal data.",
                  );
                  if (reason?.trim()) void submit("report", { reason: reason.slice(0, 2000) });
                }}
              >
                Report
              </button>
            )}
          </div>
        </section>
      )}
      {(editing || view?.owned) && (
        <section className="space-y-4 rounded-xl border p-4">
          {editing && (
            <>
              <h2 className="text-xl font-semibold">
                {view ? "Edit saved Kova" : "Create private Kova"}
              </h2>
              <fieldset disabled={disabled} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
                  <label className="text-sm">
                    Icon
                    <input
                      className="w-full rounded border bg-background p-2"
                      maxLength={16}
                      value={config.icon}
                      onChange={(e) => change({ ...config, icon: e.target.value })}
                    />
                  </label>
                  <label className="text-sm">
                    Name
                    <input
                      className="w-full rounded border bg-background p-2"
                      maxLength={120}
                      value={config.name}
                      onChange={(e) => change({ ...config, name: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Description
                  <textarea
                    className="w-full rounded border bg-background p-2"
                    maxLength={500}
                    value={config.description}
                    onChange={(e) => change({ ...config, description: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Instructions
                  <textarea
                    className="min-h-40 w-full rounded border bg-background p-2"
                    maxLength={12000}
                    value={config.instructions}
                    onChange={(e) => change({ ...config, instructions: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Conversation starters, one per line (up to six)
                  <textarea
                    className="w-full rounded border bg-background p-2"
                    value={config.starters.join("\n")}
                    maxLength={3005}
                    onChange={(e) =>
                      change({ ...config, starters: e.target.value.split("\n").slice(0, 6) })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Model mode
                  <select
                    className="ml-2 rounded border bg-background p-2"
                    value={config.mode}
                    onChange={(e) =>
                      change({ ...config, mode: e.target.value as KovaConfig["mode"] })
                    }
                  >
                    {KOVA_MODES.map((mode) => (
                      <option key={mode}>{mode}</option>
                    ))}
                  </select>
                  <span className="ml-2 text-muted-foreground">
                    Each caller’s plan must support this mode.
                  </span>
                </label>
                <div className="flex flex-wrap gap-4">
                  {KOVA_TOOLS.map((tool) => (
                    <label key={tool} className="text-sm">
                      <input
                        type="checkbox"
                        checked={config.tools.includes(tool)}
                        onChange={(e) =>
                          change({
                            ...config,
                            tools: e.target.checked
                              ? [...config.tools, tool]
                              : config.tools.filter((t) => t !== tool),
                          })
                        }
                      />{" "}
                      {tool}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4">
                  {KOVA_APPS.map((app) => (
                    <label key={app} className="text-sm">
                      <input
                        type="checkbox"
                        checked={config.apps.includes(app)}
                        onChange={(e) =>
                          change({
                            ...config,
                            apps: e.target.checked
                              ? [...config.apps, app]
                              : config.apps.filter((t) => t !== app),
                          })
                        }
                      />{" "}
                      {app}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Apps use the person chatting’s live connection and scopes. Your accounts and
                  credentials are never shared. Deep Research starts in regular chat.
                </p>
                <label className="block text-sm">
                  <input
                    type="checkbox"
                    checked={config.allowFork}
                    onChange={(e) => change({ ...config, allowFork: e.target.checked })}
                  />{" "}
                  Allow people with access to create independent copies after publication, including
                  shared knowledge.
                </label>
                <h3 className="font-semibold">Knowledge snapshots</h3>
                <p className="text-sm text-muted-foreground">
                  Selected files are copied from your Library when saving. Choose extracted text of
                  at most 30,000 characters per item, or paste a shorter excerpt. A saved version
                  has a bounded total size.
                </p>
                {config.knowledge.map((entry, i) => (
                  <div key={i} className="space-y-2 rounded border p-3">
                    {entry.kind === "library" ? (
                      <p className="text-sm">
                        Library file: {library.find((x) => x.id === entry.id)?.title ?? entry.id}
                      </p>
                    ) : (
                      <>
                        <input
                          aria-label={`Knowledge ${i + 1} title`}
                          className="w-full rounded border bg-background p-2"
                          maxLength={200}
                          value={entry.title}
                          onChange={(e) =>
                            change({
                              ...config,
                              knowledge: config.knowledge.map((k, j) =>
                                j === i ? { ...entry, title: e.target.value } : k,
                              ),
                            })
                          }
                        />
                        <textarea
                          aria-label={`Knowledge ${i + 1} excerpt`}
                          className="min-h-24 w-full rounded border bg-background p-2"
                          maxLength={30000}
                          value={entry.content}
                          onChange={(e) =>
                            change({
                              ...config,
                              knowledge: config.knowledge.map((k, j) =>
                                j === i ? { ...entry, content: e.target.value } : k,
                              ),
                            })
                          }
                        />
                      </>
                    )}
                    <button
                      className="underline text-sm"
                      onClick={() =>
                        change({ ...config, knowledge: config.knowledge.filter((_, j) => j !== i) })
                      }
                    >
                      Remove knowledge
                    </button>
                  </div>
                ))}
                <div className="flex gap-3">
                  <button
                    className="underline"
                    disabled={config.knowledge.length >= 10}
                    onClick={() =>
                      change({
                        ...config,
                        knowledge: [
                          ...config.knowledge,
                          { kind: "text", title: "Knowledge excerpt", content: "" },
                        ],
                      })
                    }
                  >
                    Add text excerpt
                  </button>
                  <button
                    className="underline"
                    disabled={config.knowledge.length >= 10}
                    onClick={() => void loadKnowledge()}
                  >
                    Choose Library file
                  </button>
                </div>
                {knowledgeOpen && (
                  <div className="space-y-2 rounded border p-3">
                    {library.map((file) => (
                      <button
                        key={file.id}
                        className="block text-left text-sm underline"
                        disabled={
                          file.characters > 30000 ||
                          config.knowledge.length >= 10 ||
                          config.knowledge.some((k) => k.kind === "library" && k.id === file.id)
                        }
                        onClick={() => {
                          change({
                            ...config,
                            knowledge: [...config.knowledge, { kind: "library", id: file.id }],
                          });
                          setKnowledgeOpen(false);
                        }}
                      >
                        {file.title} · {file.characters.toLocaleString()} characters
                        {file.characters > 30000 ? " · Paste an excerpt instead" : ""}
                      </button>
                    ))}
                    {libraryAfter && (
                      <button
                        className="underline"
                        onClick={() => void loadKnowledge(libraryAfter)}
                      >
                        Load more files
                      </button>
                    )}
                    <button className="underline" onClick={() => setKnowledgeOpen(false)}>
                      Close files
                    </button>
                  </div>
                )}
              </fieldset>
              <div className="flex gap-3">
                <button
                  className="rounded bg-primary px-3 py-2 text-primary-foreground"
                  disabled={disabled}
                  onClick={() => {
                    try {
                      void submit(view ? "save" : "create", {
                        config: normalizeKovaConfig({
                          ...config,
                          starters: config.starters.filter((s) => s.trim()),
                        }),
                      });
                    } catch {
                      setError(
                        "Check the name, instructions, starters and knowledge limits before saving.",
                      );
                    }
                  }}
                >
                  Save private version
                </button>
                {view && (
                  <button
                    className="underline"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm("Discard unsaved changes and reload the saved version?")
                      )
                        void select(view.id);
                    }}
                  >
                    Discard draft
                  </button>
                )}
              </div>
            </>
          )}
          {view?.owned && (
            <>
              <div className="flex flex-wrap gap-3">
                <button
                  className="underline"
                  disabled={disabled || dirty || view.blocked}
                  onClick={() => setPreview((v) => !v)}
                >
                  {preview ? "Close preview" : "Preview saved version"}
                </button>
                <button
                  className="underline text-destructive"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this Kova, all its versions, and all public or link access?",
                      )
                    )
                      void submit("delete", {});
                  }}
                >
                  Delete Kova
                </button>
              </div>
              <div className="space-y-2 rounded border p-3">
                <h3 className="font-semibold">Publication</h3>
                <p className="text-sm">
                  Current visibility: {view.visibility}. Edits stay private until you publish the
                  saved version.
                </p>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={disabled || dirty}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I reviewed this version and authorize sharing its instructions and knowledge
                  through responses. I have permission to share this content; it contains no
                  credentials or secrets.
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="underline"
                    disabled={disabled || dirty || !consent || view.blocked}
                    onClick={() =>
                      void submit("publish", {
                        visibility: "link",
                        versionId: view.versionId,
                        consent: view.versionId,
                        token: newKovaLinkToken(),
                      })
                    }
                  >
                    Publish with an unlisted link
                  </button>
                  <button
                    className="underline"
                    disabled={disabled || dirty || !consent || view.blocked}
                    onClick={() =>
                      void submit("publish", {
                        visibility: "public",
                        versionId: view.versionId,
                        consent: view.versionId,
                      })
                    }
                  >
                    Publish in community directory
                  </button>
                  <button
                    className="underline"
                    disabled={disabled || view.visibility === "private"}
                    onClick={() => void submit("unpublish", {})}
                  >
                    Make private
                  </button>
                </div>
                {link && (
                  <label className="block text-sm">
                    Share link. Publishing a new link revokes older links.
                    <input
                      className="w-full rounded border bg-background p-2"
                      value={link}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
              </div>
              <details>
                <summary>Version history ({versions.length}/20)</summary>
                <ul className="space-y-2 py-2">
                  {versions.map((version) => (
                    <li key={version.id} className="flex flex-wrap gap-3 text-sm">
                      <span>
                        Version {version.version} · {new Date(version.created_at).toLocaleString()}
                        {version.id === view.versionId ? " · Current" : ""}
                        {version.id === view.publicationVersion ? " · Published" : ""}
                      </span>
                      <button
                        className="underline"
                        disabled={disabled}
                        onClick={() => void inspectVersion(version.id)}
                      >
                        Inspect version
                      </button>
                      <button
                        className="underline"
                        disabled={disabled || version.id === view.versionId}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Restore version ${version.version} as a new private version?`,
                            )
                          )
                            void submit("restore", { versionId: version.id });
                        }}
                      >
                        Restore copy
                      </button>
                      <button
                        className="underline"
                        disabled={
                          disabled ||
                          version.id === view.versionId ||
                          version.id === view.publicationVersion
                        }
                        onClick={() => {
                          if (window.confirm(`Permanently delete version ${version.version}?`))
                            void submit("deleteVersion", { versionId: version.id });
                        }}
                      >
                        Delete old version
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>
      )}
      {inspected && view?.owned && (
        <section className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">Saved version inspection</h2>
          <pre className="whitespace-pre-wrap text-sm">{inspected.config.instructions}</pre>
          {inspected.knowledge.map((k, i) => (
            <details key={i}>
              <summary>{k.title}</summary>
              <pre className="whitespace-pre-wrap text-sm">{k.content}</pre>
            </details>
          ))}
          <button className="underline" onClick={() => setInspected(null)}>
            Close inspection
          </button>
        </section>
      )}
      {preview && ownerId && view?.owned && (
        <Suspense fallback={<p>Opening preview…</p>}>
          <Preview
            key={`${ownerId}:${view.versionId}`}
            ownerId={ownerId}
            kova={{ id: view.id, versionId: view.versionId }}
            starters={view.config.starters}
          />
        </Suspense>
      )}
      <p className="text-xs text-muted-foreground">
        Community Kovas can be reported and removed by moderators. Creator configuration never
        bypasses account permissions, plan limits, Lockdown Mode or confirmations.{" "}
        <Link className="underline" to={"/admin/kovas" as never}>
          Moderation
        </Link>
      </p>
    </div>
  );
}
