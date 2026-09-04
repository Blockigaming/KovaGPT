import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { listProjects, createProjectChat, type ProjectSummary } from "@/lib/projects.functions";
import {
  listResearchTemplates,
  saveResearchTemplate,
  type ResearchTemplate,
} from "@/lib/professional.functions";
import { toast } from "sonner";
import {
  browserStoragePrincipal,
  consumePrincipalHandoff,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";
import { loadPrincipalStoredRecord, WORKSPACE_DEFAULTS_KEY_BASE } from "@/lib/settings-storage";
export const Route = createFileRoute("/research-planner")({
  component: ResearchPlanner,
  head: () => ({
    meta: [{ title: "KovaGPT Research" }, { name: "robots", content: "noindex" }],
  }),
});
const starter = [
  "Define the research question and decision criteria",
  "Find primary and authoritative sources",
  "Compare claims and identify uncertainty",
  "Synthesize findings with citations",
];
function ResearchPlanner() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded && (!isSignedIn || userKey) ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const [dataGeneration, setDataGeneration] = useState(0);
  const dataReady =
    principal !== null && dataPrincipal === principal && dataGeneration === generationRef.current;
  const navigate = useNavigate();
  const list = useServerFn(listResearchTemplates),
    save = useServerFn(saveResearchTemplate),
    getProjects = useServerFn(listProjects),
    createChat = useServerFn(createProjectChat);
  const [templates, setTemplates] = useState<ResearchTemplate[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [name, setName] = useState("Research plan"),
    [question, setQuestion] = useState(""),
    [sourceContext, setSourceContext] = useState(""),
    [steps, setSteps] = useState(starter),
    [sites, setSites] = useState(""),
    [source, setSource] = useState<"balanced" | "primary" | "academic" | "recent">("balanced"),
    [projectId, setProjectId] = useState(""),
    [saving, setSaving] = useState(false);

  const loadSavedWorkspaceData = useCallback(
    async (generation: number, expectedPrincipal: string) => {
      try {
        const [nextTemplates, nextProjects] = await Promise.all([list({}), getProjects({})]);
        if (generationRef.current !== generation || principalRef.current !== expectedPrincipal)
          return;
        setTemplates(nextTemplates);
        setProjects(nextProjects);
      } catch (reason) {
        if (generationRef.current !== generation || principalRef.current !== expectedPrincipal)
          return;
        setError(reason instanceof Error ? reason.message : "Research plans could not be loaded");
      } finally {
        if (generationRef.current === generation && principalRef.current === expectedPrincipal) {
          setLoading(false);
        }
      }
    },
    [getProjects, list],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDataPrincipal(null);
    setDataGeneration(generation);
    setTemplates([]);
    setProjects([]);
    setLoading(true);
    setError(null);
    setName("Research plan");
    setQuestion("");
    setSourceContext("");
    setSteps(starter);
    setSites("");
    setSource("balanced");
    setProjectId("");
    setSaving(false);
    if (!principal) return;

    const defaults = loadPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, userKey, {
      migrateLegacyGuest: userKey === null,
    });
    const label = defaults?.research;
    setSource(
      label === "Primary sources"
        ? "primary"
        : label === "Academic sources"
          ? "academic"
          : label === "Recent sources"
            ? "recent"
            : "balanced",
    );

    if (!isSignedIn) {
      setDataPrincipal(principal);
      setDataGeneration(generation);
      setLoading(false);
      return;
    }
    const handoff = consumePrincipalHandoff<{ question: string; context: string }>(
      safeBrowserStorage("sessionStorage"),
      "kova-research-draft",
      userKey,
    );
    if (handoff.ok) {
      const draft = handoff.value;
      if (typeof draft.question === "string" && typeof draft.context === "string") {
        setQuestion(draft.question);
        setSourceContext(draft.context);
      } else {
        toast.error("The saved research context could not be loaded.");
      }
    } else if (handoff.reason !== "missing") {
      toast.error("The saved research context could not be loaded.");
    }
    if (generationRef.current !== generation || principalRef.current !== principal) return;
    setDataPrincipal(principal);
    setDataGeneration(generation);
    void loadSavedWorkspaceData(generation, principal);
  }, [isSignedIn, loadSavedWorkspaceData, principal, userKey]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setDataPrincipal(principal);
      setDataGeneration(generation);
      setTemplates([]);
      setProjects([]);
      setLoading(false);
      setError(null);
      setName("Research plan");
      setQuestion("");
      setSourceContext("");
      setSteps(starter);
      setSites("");
      setSource("balanced");
      setProjectId("");
      setSaving(false);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);
  const allowed = sites
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const hasValidSteps = steps.length > 0 && steps.every((step) => step.trim().length > 0);
  const planText = () =>
    `Research question: ${question}${sourceContext ? `\nExisting authorized context:\n${sourceContext}` : ""}\nSource preference: ${source}\nAllowed websites: ${allowed.length ? allowed.join(", ") : "No allow list"}\nPlan:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
  const savePlan = async () => {
    if (!dataReady || dataGeneration !== generationRef.current || !name.trim() || !hasValidSteps)
      return;
    const generation = generationRef.current;
    setSaving(true);
    try {
      const row = await save({
        data: { name, steps, allowed_sites: allowed, source_preference: source },
      });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTemplates((all) => [row, ...all]);
      toast.success("Research template saved");
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Template could not be saved");
      }
    } finally {
      if (generation === generationRef.current && principalRef.current === principal) {
        setSaving(false);
      }
    }
  };
  const launch = () => {
    if (
      !dataReady ||
      dataGeneration !== generationRef.current ||
      !question.trim() ||
      !hasValidSteps
    )
      return;
    const handoff = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-research-launch",
      isLoaded ? userKey : undefined,
      planText(),
    );
    if (!handoff.ok) {
      toast.error("Research context could not be prepared. Reload and try again.");
      return;
    }
    navigate({ to: "/" });
  };
  const retryLoad = () => {
    if (!principal || !isSignedIn) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDataPrincipal(principal);
    setDataGeneration(generation);
    setLoading(true);
    setError(null);
    void loadSavedWorkspaceData(generation, principal);
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
      <main
        id="main-content"
        tabIndex={-1}
        aria-busy={loading || !dataReady || undefined}
        className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6"
      >
        <WorkspacePageHeader
          icon={FlaskConical}
          title="Research Planner"
          titleId="research-planner-title"
          description="Design and reuse plans before starting Deep Research. Real provider-backed research runs appear only after authorization and a real run begins."
        />
        {!isSignedIn && !loading ? (
          <section
            className="mt-6 rounded-2xl border p-8 text-center"
            aria-labelledby="research-sign-in-title"
          >
            <h2 id="research-sign-in-title" className="text-lg font-semibold">
              Sign in to plan research
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Save reusable plans and continue them in your projects and workspace.
            </p>
            <SignInButton mode="modal">
              <Button className="mt-5">Sign in</Button>
            </SignInButton>
          </section>
        ) : loading || !dataReady ? (
          <section aria-busy="true" aria-labelledby="research-loading-title" className="mt-6">
            <h2 id="research-loading-title" className="sr-only">
              Loading research plans
            </h2>
            <div aria-hidden="true" className="h-48 animate-pulse rounded-2xl bg-muted" />
          </section>
        ) : error ? (
          <section role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            <h2 className="font-medium">Research plans could not be loaded</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your saved plans are temporarily unavailable. Try again in a moment.
            </p>
            <Button variant="outline" className="mt-4" onClick={retryLoad}>
              Try again
            </Button>
          </section>
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
                          type="button"
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
                        type="button"
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
                        type="button"
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
                        type="button"
                        disabled={steps.length === 1}
                        onClick={() =>
                          setSteps((all) =>
                            all.length === 1 ? all : all.filter((_, i) => i !== index),
                          )
                        }
                        aria-label={`Remove step ${index + 1}`}
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => setSteps((all) => [...all, ""])}
                  className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 hover:bg-accent"
                >
                  <Plus className="h-4 w-4" />
                  Add step
                </button>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !name.trim() || !hasValidSteps}
                    onClick={savePlan}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving…" : "Save template"}
                  </button>
                  <button
                    type="button"
                    onClick={download}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </button>
                  <button
                    type="button"
                    disabled={!question.trim() || !hasValidSteps}
                    onClick={launch}
                    className="min-h-11 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
                  >
                    Start Deep Research
                  </button>
                  <button
                    type="button"
                    disabled={!question.trim() || !hasValidSteps}
                    onClick={() => {
                      if (
                        !dataReady ||
                        dataGeneration !== generationRef.current ||
                        !question.trim() ||
                        !hasValidSteps
                      )
                        return;
                      const handoff = writePrincipalHandoff(
                        safeBrowserStorage("sessionStorage"),
                        "kova-work-draft",
                        isLoaded ? userKey : undefined,
                        {
                          objective: question,
                          plan: steps,
                          context: `Research sources: ${source}; allow list: ${allowed.join(", ") || "none"}`,
                        },
                      );
                      if (!handoff.ok) {
                        toast.error("Work context could not be prepared. Reload and try again.");
                        return;
                      }
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
                      type="button"
                      disabled={!projectId || !question.trim() || !hasValidSteps}
                      onClick={async () => {
                        if (
                          !dataReady ||
                          dataGeneration !== generationRef.current ||
                          !projectId ||
                          !question.trim() ||
                          !hasValidSteps
                        )
                          return;
                        const generation = generationRef.current;
                        try {
                          const row = await createChat({
                            data: {
                              project_id: projectId,
                              title: `Research: ${question.slice(0, 80)}`,
                              messages: [{ role: "user", content: planText() }],
                            },
                          });
                          if (
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
                          navigate({
                            to: "/projects/$projectId/chat/$chatId",
                            params: { projectId, chatId: row.id },
                          });
                        } catch (e) {
                          if (
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
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
                          type="button"
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
          </>
        )}
      </main>
    </AppShell>
  );
}
