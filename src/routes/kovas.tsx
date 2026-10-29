import "@/styles/spec400-management.css";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    mode: "instant",
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
type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  epoch: number;
  selectedId: string | null;
  view: KovaView;
  config: KovaConfig;
  run: () => void;
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<Confirmation | null>(null);
  const confirmationOpener = useRef<HTMLButtonElement | null>(null);
  const [reportReview, setReportReview] = useState<Pick<
    Confirmation,
    "epoch" | "selectedId" | "view"
  > | null>(null);
  const [reportReason, setReportReason] = useState("");
  const reportRef = useRef<typeof reportReview>(null);
  const reportOpener = useRef<HTMLButtonElement | null>(null);
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
      confirmationRef.current = null;
      setConfirmation(null);
      reportRef.current = null;
      setReportReview(null);
      setReportReason("");
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
  function askConfirmation(
    opener: HTMLButtonElement | null,
    options: Pick<Confirmation, "title" | "description" | "confirmLabel" | "destructive" | "run">,
  ) {
    if (!ownerId || closed || busy || retry || !view || confirmationRef.current) return;
    const request = {
      ...options,
      epoch: generation.current,
      selectedId: selection.current,
      view,
      config,
    };
    confirmationOpener.current = opener;
    confirmationRef.current = request;
    setConfirmation(request);
  }
  function closeConfirmation() {
    confirmationRef.current = null;
    setConfirmation(null);
  }
  function confirmAction() {
    const request = confirmationRef.current;
    closeConfirmation();
    if (
      !request ||
      !ownerId ||
      closed ||
      busy ||
      retry ||
      !alive(request.epoch) ||
      selection.current !== request.selectedId ||
      view !== request.view ||
      config !== request.config
    )
      return;
    request.run();
  }
  function openReport(opener: HTMLButtonElement) {
    if (!ownerId || closed || busy || retry || !view?.publicationVersion || reportRef.current)
      return;
    const request = { epoch: generation.current, selectedId: selection.current, view };
    reportOpener.current = opener;
    reportRef.current = request;
    setReportReview(request);
    setReportReason("");
  }
  function closeReport() {
    reportRef.current = null;
    setReportReview(null);
    setReportReason("");
  }
  function submitReport() {
    const request = reportRef.current;
    if (!reportReason.trim()) return;
    closeReport();
    if (
      !request ||
      !ownerId ||
      closed ||
      busy ||
      retry ||
      !alive(request.epoch) ||
      selection.current !== request.selectedId ||
      view !== request.view
    )
      return;
    void submit("report", { reason: reportReason.slice(0, 2000) });
  }
  if (closed) return <p role="status">Device data was cleared. Reload to open Kovas again.</p>;
  const disabled = busy || Boolean(retry);
  const filtered = cards.filter((c) =>
    `${c.config.name} ${c.config.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="kova-page kova-secondary-page kova-assistants-page"
      data-ui-reference="chatgpt.gpts.directory"
    >
      <header className="kova-page-header">
        <div className="mr-auto">
          <h1 className="kova-page-title">Custom Kovas</h1>
          <p className="kova-page-description">
            Your instructions, selected knowledge, and tools. Private until you publish.
          </p>
        </div>
        {ownerId ? (
          <Button
            variant="default"
            className="inline-flex items-center justify-center bg-primary text-primary-foreground"
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
          </Button>
        ) : (
          <SignInButton mode="modal">
            <Button variant="outline" className="inline-flex items-center justify-center border">
              Sign in to create or chat
            </Button>
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
          <Button
            variant="link"
            className="underline"
            disabled={busy}
            onClick={() => void submit(retry.action, retry.payload, retry)}
          >
            Retry the same action
          </Button>{" "}
          or{" "}
          <Button
            variant="link"
            className="underline"
            disabled={busy}
            onClick={() => {
              setRetry(null);
              if (retry.id) void select(retry.id);
              else void list();
            }}
          >
            refresh account state
          </Button>{" "}
          before editing.
        </p>
      )}
      <div className="kova-assistant-tabs" role="group" aria-label="Custom Kova collection">
        <Button
          variant={scope === "owned" ? "secondary" : "ghost"}
          aria-pressed={scope === "owned"}
          disabled={disabled || !ownerId}
          onClick={() => setScope("owned")}
        >
          My Kovas
        </Button>
        <Button
          variant={scope === "directory" ? "secondary" : "ghost"}
          aria-pressed={scope === "directory"}
          disabled={disabled}
          onClick={() => setScope("directory")}
        >
          Community directory
        </Button>
        <label className="ml-auto flex max-w-full flex-wrap items-center gap-2 text-sm">
          Search loaded Kovas
          <Input
            className="min-h-11 min-w-11 max-w-full border bg-background"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="kova-assistant-grid">
        {filtered.map((card) => (
          <button
            data-kova-button-shape="preserve"
            data-ui-reference="chatgpt.gpts.card"
            key={card.id}
            className="kova-assistant-card"
            disabled={disabled || !ownerId}
            onClick={() => void select(card.id)}
          >
            <span aria-hidden="true" className="kova-assistant-avatar">
              {card.config.icon}
            </span>
            <strong className="kova-assistant-name">{card.config.name}</strong>
            <p className="kova-assistant-description">{card.config.description}</p>
            <p className="kova-assistant-metadata">
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
        <Button
          variant="link"
          className="underline"
          disabled={disabled}
          onClick={() => void list(scope, next)}
        >
          Load more Kovas
        </Button>
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              className="inline-flex items-center justify-center bg-primary text-primary-foreground"
              disabled={disabled || view.blocked}
              onClick={() => void startChat()}
            >
              Start a chat
            </Button>
            {view.config.starters.map((s, i) => (
              <Button
                variant="outline"
                key={i}
                className="inline-flex items-center justify-center border text-sm"
                disabled={disabled || view.blocked}
                onClick={() => void startChat(s)}
              >
                {s}
              </Button>
            ))}
            {view.owned && (
              <Button
                variant="link"
                className="inline-flex items-center justify-center underline"
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                Edit Kova
              </Button>
            )}
            <Button
              variant="link"
              className="inline-flex items-center justify-center underline"
              disabled={disabled || view.blocked || (!view.owned && !view.config.allowFork)}
              onClick={(event) =>
                askConfirmation(event.currentTarget, {
                  title: "Create a private copy?",
                  description:
                    "Create a private copy of this Kova and its shared knowledge in your account?",
                  confirmLabel: "Create copy",
                  run: () =>
                    void submit("fork", {
                      consent: view.owned ? view.versionId : view.publicationVersion,
                    }),
                })
              }
            >
              Create a private copy
            </Button>
            {view.publicationVersion && (
              <Button
                variant="link"
                className="inline-flex items-center justify-center underline"
                disabled={disabled}
                onClick={(event) => openReport(event.currentTarget)}
              >
                Report
              </Button>
            )}
          </div>
        </section>
      )}
      {(editing || view?.owned) && (
        <section className="kova-assistant-editor" data-ui-reference="chatgpt.gpts.configure">
          {editing && (
            <>
              <h2 className="text-xl font-semibold">
                {view ? "Edit saved Kova" : "Create private Kova"}
              </h2>
              <fieldset disabled={disabled} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
                  <label className="text-sm">
                    Icon
                    <Input
                      className="w-full border bg-background"
                      maxLength={16}
                      value={config.icon}
                      onChange={(e) => change({ ...config, icon: e.target.value })}
                    />
                  </label>
                  <label className="text-sm">
                    Name
                    <Input
                      className="w-full border bg-background"
                      maxLength={120}
                      value={config.name}
                      onChange={(e) => change({ ...config, name: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Description
                  <Textarea
                    className="w-full border bg-background"
                    maxLength={500}
                    value={config.description}
                    onChange={(e) => change({ ...config, description: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Instructions
                  <Textarea
                    className="min-h-40 w-full border bg-background"
                    maxLength={12000}
                    value={config.instructions}
                    onChange={(e) => change({ ...config, instructions: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Conversation starters, one per line (up to six)
                  <Textarea
                    className="w-full border bg-background"
                    value={config.starters.join("\n")}
                    maxLength={3005}
                    onChange={(e) =>
                      change({ ...config, starters: e.target.value.split("\n").slice(0, 6) })
                    }
                  />
                </label>
                <div className="space-y-2 text-sm">
                  <label htmlFor="kova-model-mode">Model mode</label>
                  <Select
                    disabled={disabled}
                    value={config.mode}
                    onValueChange={(value) =>
                      change({ ...config, mode: value as KovaConfig["mode"] })
                    }
                  >
                    <SelectTrigger id="kova-model-mode" aria-describedby="kova-model-mode-hint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KOVA_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="kova-model-mode-hint" className="text-muted-foreground">
                    Each caller’s plan must support this mode.
                  </p>
                </div>
                <div className="flex flex-wrap gap-4">
                  {KOVA_TOOLS.map((tool) => (
                    <label key={tool} className="text-sm">
                      <input
                        className="kova-native-check"
                        data-ui-reference="chatgpt.checkbox"
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
                        className="kova-native-check"
                        data-ui-reference="chatgpt.checkbox"
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
                  credentials are never shared.
                </p>
                <label className="block text-sm">
                  <input
                    className="kova-native-check"
                    data-ui-reference="chatgpt.checkbox"
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
                        <Input
                          aria-label={`Knowledge ${i + 1} title`}
                          className="w-full border bg-background"
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
                        <Textarea
                          aria-label={`Knowledge ${i + 1} excerpt`}
                          className="min-h-24 w-full border bg-background"
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
                    <Button
                      variant="link"
                      className="underline text-sm"
                      onClick={() =>
                        change({ ...config, knowledge: config.knowledge.filter((_, j) => j !== i) })
                      }
                    >
                      Remove knowledge
                    </Button>
                  </div>
                ))}
                <div className="flex gap-3">
                  <Button
                    variant="link"
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
                  </Button>
                  <Button
                    variant="link"
                    className="underline"
                    disabled={config.knowledge.length >= 10}
                    onClick={() => void loadKnowledge()}
                  >
                    Choose Library file
                  </Button>
                </div>
                {knowledgeOpen && (
                  <div className="space-y-2 rounded border p-3">
                    {library.map((file) => (
                      <Button
                        variant="link"
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
                      </Button>
                    ))}
                    {libraryAfter && (
                      <Button
                        variant="link"
                        className="underline"
                        onClick={() => void loadKnowledge(libraryAfter)}
                      >
                        Load more files
                      </Button>
                    )}
                    <Button
                      variant="link"
                      className="underline"
                      onClick={() => setKnowledgeOpen(false)}
                    >
                      Close files
                    </Button>
                  </div>
                )}
              </fieldset>
              <div className="flex gap-3">
                <Button
                  variant="default"
                  className="bg-primary text-primary-foreground"
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
                </Button>
                {view && (
                  <Button
                    variant="link"
                    className="underline"
                    disabled={disabled}
                    onClick={(event) => {
                      if (!dirty) void select(view.id);
                      else
                        askConfirmation(event.currentTarget, {
                          title: "Discard draft?",
                          description: "Discard unsaved changes and reload the saved version?",
                          confirmLabel: "Discard draft",
                          destructive: true,
                          run: () => void select(view.id),
                        });
                    }}
                  >
                    Discard draft
                  </Button>
                )}
              </div>
            </>
          )}
          {view?.owned && (
            <>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="link"
                  className="underline"
                  disabled={disabled || dirty || view.blocked}
                  onClick={() => setPreview((v) => !v)}
                >
                  {preview ? "Close preview" : "Preview saved version"}
                </Button>
                <Button
                  variant="link"
                  className="underline text-destructive"
                  disabled={disabled}
                  onClick={(event) =>
                    askConfirmation(event.currentTarget, {
                      title: "Delete Kova?",
                      description:
                        "Delete this Kova, all its versions, and all public or link access?",
                      confirmLabel: "Delete Kova",
                      destructive: true,
                      run: () => void submit("delete", {}),
                    })
                  }
                >
                  Delete Kova
                </Button>
              </div>
              <div className="space-y-2 rounded border p-3">
                <h3 className="font-semibold">Publication</h3>
                <p className="text-sm">
                  Current visibility: {view.visibility}. Edits stay private until you publish the
                  saved version.
                </p>
                <label className="flex gap-2 text-sm">
                  <input
                    className="kova-native-check"
                    data-ui-reference="chatgpt.checkbox"
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
                  <Button
                    variant="link"
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
                  </Button>
                  <Button
                    variant="link"
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
                  </Button>
                  <Button
                    variant="link"
                    className="underline"
                    disabled={disabled || view.visibility === "private"}
                    onClick={() => void submit("unpublish", {})}
                  >
                    Make private
                  </Button>
                </div>
                {link && (
                  <label className="block text-sm">
                    Share link. Publishing a new link revokes older links.
                    <Input
                      className="w-full border bg-background"
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
                      <Button
                        variant="link"
                        className="underline"
                        disabled={disabled}
                        onClick={() => void inspectVersion(version.id)}
                      >
                        Inspect version
                      </Button>
                      <Button
                        variant="link"
                        className="underline"
                        disabled={disabled || version.id === view.versionId}
                        onClick={(event) =>
                          askConfirmation(event.currentTarget, {
                            title: "Restore version?",
                            description: `Restore version ${version.version} as a new private version?`,
                            confirmLabel: "Restore copy",
                            run: () => void submit("restore", { versionId: version.id }),
                          })
                        }
                      >
                        Restore copy
                      </Button>
                      <Button
                        variant="link"
                        className="underline"
                        disabled={
                          disabled ||
                          version.id === view.versionId ||
                          version.id === view.publicationVersion
                        }
                        onClick={(event) =>
                          askConfirmation(event.currentTarget, {
                            title: "Delete old version?",
                            description: `Permanently delete version ${version.version}?`,
                            confirmLabel: "Delete version",
                            destructive: true,
                            run: () => void submit("deleteVersion", { versionId: version.id }),
                          })
                        }
                      >
                        Delete old version
                      </Button>
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
          <Button variant="link" className="underline" onClick={() => setInspected(null)}>
            Close inspection
          </Button>
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
      <ConfirmActionDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}
        title={confirmation?.title ?? "Confirm action"}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
        destructive={confirmation?.destructive}
        disabled={disabled}
        onConfirm={confirmAction}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (confirmationOpener.current?.isConnected)
            confirmationOpener.current.focus({ preventScroll: true });
        }}
      />
      <Dialog
        open={reportReview !== null}
        onOpenChange={(open) => {
          if (!open) closeReport();
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (reportOpener.current?.isConnected)
              reportOpener.current.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Report Kova</DialogTitle>
            <DialogDescription>
              What should moderators review? Do not include sensitive personal data.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitReport();
            }}
          >
            <label className="grid gap-2 text-sm" htmlFor="kova-report-reason">
              Reason for report
              <Textarea
                id="kova-report-reason"
                className="min-h-32 w-full border border-input bg-background text-sm"
                maxLength={2000}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeReport}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || !reportReason.trim()}>
                Submit report
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
