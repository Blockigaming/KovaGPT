import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Download,
  FlaskConical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import { useUser } from "@/components/auth/ClerkSafe";
import { listProjects, createProjectChat, type ProjectSummary } from "@/lib/projects.functions";
import {
  listResearchTemplates,
  saveResearchTemplate,
  type ResearchTemplate,
} from "@/lib/professional.functions";
import { toast } from "sonner";
import {
  archiveResearchSession,
  deleteResearchSession,
  listResearchSessions,
  type ResearchSession,
} from "@/lib/research.functions";
export const Route = createFileRoute("/research-planner")({
  component: ResearchPlanner,
  head: () => ({
    meta: [{ title: "Research Planner | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
const starter = [
  "Define the research question and decision criteria",
  "Find primary and authoritative sources",
  "Compare claims and identify uncertainty",
  "Synthesize findings with citations",
];
function ResearchPlanner() {
  const { isLoaded, isSignedIn } = useUser();
  const navigate = useNavigate();
  const list = useServerFn(listResearchTemplates),
    save = useServerFn(saveResearchTemplate),
    getProjects = useServerFn(listProjects),
    createChat = useServerFn(createProjectChat);
  const getSessions = useServerFn(listResearchSessions),
    archiveSession = useServerFn(archiveResearchSession),
    deleteSession = useServerFn(deleteResearchSession);
  const [templates, setTemplates] = useState<ResearchTemplate[]>([]),
    [sessions, setSessions] = useState<ResearchSession[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [name, setName] = useState("Research plan"),
    [question, setQuestion] = useState(""),
    [sourceContext, setSourceContext] = useState(""),
    [steps, setSteps] = useState(starter),
    [sites, setSites] = useState(""),
    [source, setSource] = useState<"balanced" | "primary" | "academic" | "recent">(() => {
      try {
        const label = JSON.parse(
          localStorage.getItem("kova-workspace-defaults-v1") ?? "{}",
        ).research;
        return label === "Primary sources"
          ? "primary"
          : label === "Academic sources"
            ? "academic"
            : label === "Recent sources"
              ? "recent"
              : "balanced";
      } catch {
        return "balanced";
      }
    }),
    [projectId, setProjectId] = useState(""),
    [saving, setSaving] = useState(false),
    [pendingDelete, setPendingDelete] = useState<ResearchSession | null>(null),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    try {
      const raw = localStorage.getItem("kova-research-draft");
      if (raw) {
        const draft = JSON.parse(raw) as { question: string; context: string };
        setQuestion(draft.question);
        setSourceContext(draft.context);
        localStorage.removeItem("kova-research-draft");
      }
    } catch {
      localStorage.removeItem("kova-research-draft");
    }
    Promise.all([list({}), getProjects({}), getSessions({})])
      .then(([t, p, r]) => {
        setTemplates(t);
        setProjects(p);
        setSessions(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Research plans could not be loaded"))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list, getProjects, getSessions]);
  const allowed = sites
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const planText = () =>
    `Research question: ${question}${sourceContext ? `\nExisting authorized context:\n${sourceContext}` : ""}\nSource preference: ${source}\nAllowed websites: ${allowed.length ? allowed.join(", ") : "No allow list"}\nPlan:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
  const savePlan = async () => {
    setSaving(true);
    try {
      const row = await save({
        data: { name, steps, allowed_sites: allowed, source_preference: source },
      });
      setTemplates((all) => [row, ...all]);
      toast.success("Research template saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Template could not be saved");
    } finally {
      setSaving(false);
    }
  };
  const launch = () => {
    if (!question.trim()) return;
    localStorage.setItem("kova-research-launch", planText());
    navigate({ to: "/" });
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`# ${name}\n\n${planText()}`], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "research-plan"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={FlaskConical}
          title="Research Planner"
          description="Design and reuse research plans before starting provider-backed Deep Research. Progress appears only after a real run begins."
        />
        {!isSignedIn && !loading ? (
          <div className="mt-6 rounded-2xl border p-8 text-center">
            Sign in to save and reuse research plans.
          </div>
        ) : loading ? (
          <div className="mt-6 h-48 animate-pulse rounded-2xl bg-muted" />
        ) : error ? (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_19rem]">
              <section className="rounded-2xl border p-4">
                <div className="grid gap-3">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    aria-label="Research plan name"
                  />
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="min-h-24 rounded-xl border bg-background p-3"
                    placeholder="What should KovaGPT investigate?"
                    aria-label="Research question"
                  />
                  {sourceContext ? (
                    <div className="rounded-xl bg-muted/60 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <strong>Attached workspace context</strong>
                        <button
                          onClick={() => setSourceContext("")}
                          className="text-xs hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {sourceContext}
                      </p>
                    </div>
                  ) : null}
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as typeof source)}
                    className="h-11 rounded-xl border bg-background px-3"
                    aria-label="Source preference"
                  >
                    <option value="balanced">Balanced sources</option>
                    <option value="primary">Primary sources first</option>
                    <option value="academic">Academic sources first</option>
                    <option value="recent">Recent sources first</option>
                  </select>
                  <textarea
                    value={sites}
                    onChange={(e) => setSites(e.target.value)}
                    className="min-h-20 rounded-xl border bg-background p-3"
                    placeholder="Website allow list, one domain per line (optional)"
                    aria-label="Website allow list"
                  />
                </div>
                <h2 className="mt-5 font-semibold">Editable plan</h2>
                <ol className="mt-2 space-y-2">
                  {steps.map((step, index) => (
                    <li key={index} className="flex flex-wrap gap-2">
                      <input
                        value={step}
                        onChange={(e) =>
                          setSteps((all) =>
                            all.map((value, i) => (i === index ? e.target.value : value)),
                          )
                        }
                        className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3"
                        aria-label={`Research step ${index + 1}`}
                      />
                      <button
                        disabled={index === 0}
                        onClick={() =>
                          setSteps((all) => {
                            const next = [...all];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            return next;
                          })
                        }
                        aria-label={`Move step ${index + 1} up`}
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-accent disabled:opacity-40"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        disabled={index === steps.length - 1}
                        onClick={() =>
                          setSteps((all) => {
                            const next = [...all];
                            [next[index + 1], next[index]] = [next[index], next[index + 1]];
                            return next;
                          })
                        }
                        aria-label={`Move step ${index + 1} down`}
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-accent disabled:opacity-40"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSteps((all) => all.filter((_, i) => i !== index))}
                        aria-label={`Remove step ${index + 1}`}
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  onClick={() => setSteps((all) => [...all, ""])}
                  className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 hover:bg-accent"
                >
                  <Plus className="h-4 w-4" />
                  Add step
                </button>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    disabled={saving || !name.trim() || steps.some((step) => !step.trim())}
                    onClick={savePlan}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving…" : "Save template"}
                  </button>
                  <button
                    onClick={download}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </button>
                  <button
                    disabled={!question.trim() || steps.some((step) => !step.trim())}
                    onClick={launch}
                    className="min-h-11 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
                  >
                    Start Deep Research
                  </button>
                  <button
                    disabled={!question.trim()}
                    onClick={() => {
                      localStorage.setItem(
                        "kova-work-draft",
                        JSON.stringify({
                          objective: question,
                          plan: steps,
                          context: `Research sources: ${source}; allow list: ${allowed.join(", ") || "none"}`,
                        }),
                      );
                      navigate({ to: "/work" });
                    }}
                    className="min-h-11 rounded-xl border px-4"
                  >
                    Continue in Work
                  </button>
                </div>
                {projects.length > 0 && (
                  <div className="mt-4 flex gap-2">
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3"
                      aria-label="Continue in Project"
                    >
                      <option value="">Choose Project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!projectId || !question.trim()}
                      onClick={async () => {
                        try {
                          const row = await createChat({
                            data: {
                              project_id: projectId,
                              title: `Research: ${question.slice(0, 80)}`,
                              messages: [{ role: "user", content: planText() }],
                            },
                          });
                          navigate({
                            to: "/projects/$projectId/chat/$chatId",
                            params: { projectId, chatId: row.id },
                          });
                        } catch (e) {
                          toast.error(
                            e instanceof Error
                              ? e.message
                              : "Project research could not be created",
                          );
                        }
                      }}
                      className="min-h-11 rounded-xl border px-4 disabled:opacity-50"
                    >
                      Continue in Project
                    </button>
                  </div>
                )}
              </section>
              <aside>
                <h2 className="font-semibold">Saved templates</h2>
                {templates.length === 0 ? (
                  <div className="mt-3 rounded-2xl border p-6 text-center text-sm text-muted-foreground">
                    No saved plans yet.
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {templates.map((template) => (
                      <li key={template.id}>
                        <button
                          onClick={() => {
                            setName(template.name);
                            setSteps(template.steps);
                            setSites(template.allowed_sites.join("\n"));
                            setSource(template.source_preference);
                          }}
                          className="w-full rounded-xl border p-3 text-left hover:bg-accent"
                        >
                          <span className="font-medium">{template.name}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {template.steps.length} steps · {template.source_preference}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
            <RelatedWorkspaceItems
              kinds={["project", "file", "artifact", "context_pack", "memory"]}
              title="Research context"
            />
            <section className="mt-8" aria-labelledby="research-history-heading">
              <h2 id="research-history-heading" className="text-lg font-semibold">
                Research history
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Real provider-backed research runs saved to your account. Archived runs remain
                private and restorable.
              </p>
              {sessions.length === 0 ? (
                <div className="mt-3 rounded-2xl border p-6 text-sm text-muted-foreground">
                  No research runs yet. Starting Deep Research creates a session only after the
                  provider accepts the request.
                </div>
              ) : (
                <ul className="mt-3 divide-y rounded-2xl border">
                  {sessions.map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={session.title || session.query}>
                          {session.title || session.query}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {session.status.replaceAll("_", " ")} · Updated{" "}
                          {new Date(session.updated_at).toLocaleDateString()}
                          {session.archived_at ? " · Archived" : ""}
                        </p>
                      </div>
                      {session.report ? (
                        <button
                          className="min-h-10 rounded-lg px-3 hover:bg-accent"
                          onClick={() => {
                            localStorage.setItem("kova-writing-draft", session.report ?? "");
                            navigate({ to: "/write" });
                          }}
                        >
                          Send to Writing
                        </button>
                      ) : null}
                      <button
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-accent"
                        aria-label={
                          session.archived_at
                            ? "Restore research session"
                            : "Archive research session"
                        }
                        onClick={async () => {
                          const archived = !session.archived_at;
                          try {
                            await archiveSession({ data: { id: session.id, archived } });
                            setSessions((all) =>
                              all.map((item) =>
                                item.id === session.id
                                  ? {
                                      ...item,
                                      archived_at: archived ? new Date().toISOString() : null,
                                    }
                                  : item,
                              ),
                            );
                            toast.success(
                              archived ? "Research session archived" : "Research session restored",
                            );
                          } catch (cause) {
                            toast.error(
                              cause instanceof Error
                                ? cause.message
                                : "Research session could not be updated",
                            );
                          }
                        }}
                      >
                        {session.archived_at ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                        aria-label="Delete research session"
                        onClick={() => setPendingDelete(session)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}
        title="Delete research session?"
        description="This permanently removes the saved run and its evidence. This action cannot be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete session"}
        destructive
        disabled={deleting}
        onConfirm={async () => {
          if (!pendingDelete || deleting) return;
          setDeleting(true);
          try {
            await deleteSession({ data: { id: pendingDelete.id } });
            setSessions((all) => all.filter((item) => item.id !== pendingDelete.id));
            setPendingDelete(null);
            toast.success("Research session deleted");
          } catch (cause) {
            toast.error(
              cause instanceof Error ? cause.message : "Research session could not be deleted",
            );
          } finally {
            setDeleting(false);
          }
        }}
      />
    </AppShell>
  );
}
