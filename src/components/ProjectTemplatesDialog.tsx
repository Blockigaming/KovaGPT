import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Copy, FileStack, Loader2, Plus, RefreshCw, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  createProjectTemplateClient,
  prepareProjectTemplateOperation,
  projectTemplateFailureMessage,
  ProjectTemplateRequestError,
  type ProjectTemplateDraftMutation,
  type ProjectTemplateOperation,
  type ProjectTemplateSummary,
  type ProjectTemplateVersion,
} from "@/lib/project-template-client";
import type { ProjectTemplateSnapshot } from "@/lib/project-template-policy.mjs";

const emptySnapshot = (): ProjectTemplateSnapshot => ({
  projectName: "",
  projectDescription: null,
  systemPrompt: null,
  color: "blue",
});
const colors = ["blue", "green", "red", "orange", "yellow", "purple", "pink", "teal"];

export function ProjectTemplatesDialog({
  open,
  onOpenChange,
  userId,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onCopied: (projectId: string) => void;
}) {
  const client = useMemo(
    () => createProjectTemplateClient({ userId, getSession: () => supabase.auth.getSession() }),
    [userId],
  );
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [loadedPreview, setPreview] = useState<ProjectTemplateVersion | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mode, setMode] = useState<"details" | "create" | "publish">("details");
  const [draft, setDraft] = useState<ProjectTemplateSnapshot>(emptySnapshot);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantCanCopy, setGrantCanCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ProjectTemplateOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProjectTemplateSummary | null>(null);
  const mounted = useRef(true);
  const active = useRef(open);
  const currentSelection = useRef({ id: selectedId, version: selectedVersion });
  const listSequence = useRef(0);
  const previewSequence = useRef(0);
  const detailsRef = useRef<HTMLElement | null>(null);
  const listController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const pendingRef = useRef<ProjectTemplateOperation | null>(null);
  active.current = open;
  currentSelection.current = { id: selectedId, version: selectedVersion };
  const selected = templates.find((entry) => entry.id === selectedId) ?? null;
  const preview =
    loadedPreview?.templateId === selectedId && loadedPreview.version === selectedVersion
      ? loadedPreview
      : null;
  const owner = selected?.ownerId === userId;
  const outdated = Boolean(selected && preview && selected.revision !== preview.revision);
  const locked = busy || Boolean(pending) || needsRefresh || loading || outdated;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
      mutationController.current?.abort();
      listSequence.current += 1;
      previewSequence.current += 1;
    };
  }, []);

  async function refresh(preferredId?: string, preferredVersion?: number) {
    const sequence = ++listSequence.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await client.list(controller.signal);
      if (!mounted.current || !active.current || sequence !== listSequence.current) return;
      setTemplates(result);
      const id = preferredId ?? currentSelection.current.id;
      const next = result.find((entry) => entry.id === id);
      setSelectedId(next?.id ?? null);
      if (next) {
        const version = preferredVersion ?? currentSelection.current.version;
        setSelectedVersion(
          next.versions.some((entry) => entry.version === version) ? version : next.currentVersion,
        );
      }
      setNeedsRefresh(false);
      if (!pendingRef.current) setError(null);
    } catch (failure) {
      if (
        !mounted.current ||
        !active.current ||
        sequence !== listSequence.current ||
        controller.signal.aborted
      )
        return;
      setLoadError(projectTemplateFailureMessage(failure));
      setNeedsRefresh(true);
    } finally {
      if (mounted.current && sequence === listSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
    else {
      listSequence.current += 1;
      listController.current?.abort();
      setArchiveTarget(null);
    }
    // Refresh only on dialog/account entry. Other refreshes follow user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  useEffect(() => {
    const sequence = ++previewSequence.current;
    const controller = new AbortController();
    setPreview(null);
    setPreviewError(null);
    if (!open || !selected) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void client
      .version(selected.id, selectedVersion, controller.signal)
      .then((result) => {
        if (mounted.current && sequence === previewSequence.current) setPreview(result);
      })
      .catch((failure) => {
        if (!mounted.current || sequence !== previewSequence.current || controller.signal.aborted)
          return;
        setPreviewError(projectTemplateFailureMessage(failure));
        if (
          failure instanceof ProjectTemplateRequestError &&
          [401, 403, 404].includes(failure.status)
        )
          setNeedsRefresh(true);
      })
      .finally(() => {
        if (mounted.current && sequence === previewSequence.current) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [client, open, selected, selectedVersion]);

  useEffect(() => {
    if (
      open &&
      (selectedId || mode === "create") &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      detailsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [open, selectedId, mode]);

  async function send(operation: ProjectTemplateOperation) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const controller = new AbortController();
    mutationController.current = controller;
    try {
      const result = await client.mutate(operation, controller.signal);
      if (!mounted.current) return;
      pendingRef.current = null;
      setPending(null);
      setMode("details");
      setGrantUserId("");
      setSuccess(
        operation.action === "copy"
          ? "Project created from the selected version."
          : operation.action === "publishVersion"
            ? "New version published. Existing projects are unchanged."
            : operation.action === "create"
              ? "Template saved with version 1."
              : operation.action === "archive"
                ? "Template archived and all sharing access revoked."
                : "Template access updated.",
      );
      if (operation.action === "copy" && result.projectId) {
        onCopied(result.projectId);
      } else if (active.current) {
        setNeedsRefresh(true);
        await refresh(result.templateId, result.version);
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError(projectTemplateFailureMessage(failure, operation.action));
      if (!(failure instanceof ProjectTemplateRequestError) || !failure.uncertain) {
        pendingRef.current = null;
        setPending(null);
      }
      if (
        failure instanceof ProjectTemplateRequestError &&
        [401, 403, 404, 409].includes(failure.status)
      ) {
        setNeedsRefresh(true);
        if (failure.status !== 409) {
          setPreview(null);
          setMode("details");
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function mutate(input: ProjectTemplateDraftMutation) {
    if (inFlight.current || pendingRef.current || needsRefresh) return;
    try {
      const operation = prepareProjectTemplateOperation(input);
      pendingRef.current = operation;
      setPending(operation);
      void send(operation);
    } catch (failure) {
      setError(projectTemplateFailureMessage(failure));
    }
  }

  function beginCreate() {
    setMode("create");
    setTemplateName("");
    setTemplateDescription("");
    setDraft(emptySnapshot());
    setError(null);
    setSuccess(null);
  }

  const canCopy = Boolean(selected && preview && !selected.archivedAt && preview.canCopy);
  const canManage = Boolean(owner && selected && !selected.archivedAt && preview);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:w-[min(94vw,1040px)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5" aria-hidden="true" /> Project templates
            </DialogTitle>
            <DialogDescription>
              Save project names, descriptions, instructions, and colors as reusable versions.
              Chats, files, memories, and members are not included.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" className="min-h-11" onClick={beginCreate} disabled={locked}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New template
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => void refresh()}
              disabled={busy || loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />{" "}
              Refresh templates
            </Button>
          </div>
          {success && (
            <p role="status" className="rounded-lg bg-accent p-3 text-sm">
              {success}
            </p>
          )}
          {(error || loadError) && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"
            >
              {error && <p>{error}</p>}
              {loadError && <p>{loadError}</p>}
              {pending && !busy && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    if (pendingRef.current) void send(pendingRef.current);
                  }}
                >
                  Retry same request
                </Button>
              )}
            </div>
          )}
          <div className="grid min-w-0 gap-5 md:grid-cols-[250px_minmax(0,1fr)]">
            <aside
              aria-label="Saved templates"
              className="space-y-3 border-b pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4"
            >
              <h3 className="text-sm font-medium">Your templates and shared templates</h3>
              {loading && templates.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading templates…
                </p>
              )}
              {!loading && !loadError && templates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No saved templates yet. Create one or ask an owner to share one with you.
                </p>
              )}
              <div className="max-h-52 space-y-1 overflow-y-auto md:max-h-[48vh]">
                {templates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    aria-pressed={selectedId === template.id && mode !== "create"}
                    disabled={busy || Boolean(pending)}
                    onClick={() => {
                      setSelectedId(template.id);
                      setSelectedVersion(template.currentVersion);
                      setMode("details");
                      setError(null);
                      setSuccess(null);
                      setGrantUserId("");
                      setGrantCanCopy(false);
                    }}
                    className={`min-h-11 w-full rounded-lg border p-3 text-left text-sm disabled:opacity-60 ${selectedId === template.id && mode !== "create" ? "border-primary bg-accent" : "border-transparent hover:bg-accent"}`}
                  >
                    <span className="block break-words font-medium">{template.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {template.ownerId === userId
                        ? "Owned by you"
                        : template.canCopy
                          ? "Shared · Can copy"
                          : "Shared · View only"}{" "}
                      · v{template.currentVersion}
                      {template.archivedAt ? " · Archived" : ""}
                    </span>
                  </button>
                ))}
              </div>
              {templates.length === 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing the 50 most recently updated templates.
                </p>
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer py-2">Receive a shared template</summary>
                <p className="mb-2">
                  Give the owner your account ID. They choose whether you can view the template or
                  also copy it.
                </p>
                <Input
                  aria-label="Your account ID"
                  value={userId}
                  readOnly
                  className="text-xs"
                  onFocus={(event) => event.target.select()}
                />
              </details>
            </aside>
            <section ref={detailsRef} aria-label="Template details" className="min-w-0 space-y-4">
              {mode === "create" || mode === "publish" ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (locked) return;
                    if (mode === "create")
                      mutate({
                        action: "create",
                        name: templateName,
                        description: templateDescription || null,
                        snapshot: draft,
                      });
                    else if (selected && owner && !selected.archivedAt)
                      mutate({
                        action: "publishVersion",
                        templateId: selected.id,
                        expectedRevision: selected.revision,
                        snapshot: draft,
                      });
                  }}
                >
                  <h3 className="font-medium">
                    {mode === "create"
                      ? "Create a saved template"
                      : `Publish version ${(selected?.currentVersion ?? 0) + 1}`}
                  </h3>
                  {mode === "publish" && (
                    <p className="text-sm text-muted-foreground">
                      Your draft starts from version {selectedVersion}. Publishing adds a version;
                      existing versions and copied projects stay unchanged.
                    </p>
                  )}
                  <fieldset disabled={locked} className="min-w-0 space-y-3">
                    {mode === "create" && (
                      <>
                        <label className="block text-sm">
                          Template name
                          <Input
                            className="mt-1"
                            value={templateName}
                            onChange={(event) => setTemplateName(event.target.value)}
                            maxLength={100}
                            required
                          />
                        </label>
                        <label className="block text-sm">
                          Template description
                          <Textarea
                            className="mt-1"
                            aria-label="Template description"
                            value={templateDescription}
                            onChange={(event) => setTemplateDescription(event.target.value)}
                            maxLength={1000}
                            rows={2}
                          />
                        </label>
                      </>
                    )}
                    <label className="block text-sm">
                      Project name
                      <Input
                        className="mt-1"
                        value={draft.projectName}
                        onChange={(event) =>
                          setDraft({ ...draft, projectName: event.target.value })
                        }
                        maxLength={100}
                        required
                      />
                    </label>
                    <label className="block text-sm">
                      Project description
                      <Textarea
                        className="mt-1"
                        aria-label="Project description"
                        value={draft.projectDescription ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, projectDescription: event.target.value || null })
                        }
                        maxLength={1000}
                        rows={2}
                      />
                    </label>
                    <label className="block text-sm">
                      Project instructions
                      <Textarea
                        className="mt-1"
                        aria-label="Project instructions"
                        value={draft.systemPrompt ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, systemPrompt: event.target.value || null })
                        }
                        maxLength={4000}
                        rows={5}
                      />
                    </label>
                    <label className="block text-sm">
                      Project color
                      <select
                        className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
                        value={draft.color}
                        onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                      >
                        {!colors.includes(draft.color) && (
                          <option value={draft.color}>{draft.color}</option>
                        )}
                        {colors.map((color) => (
                          <option key={color} value={color}>
                            {color}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        className="min-h-11"
                        disabled={
                          !draft.projectName.trim() || (mode === "create" && !templateName.trim())
                        }
                      >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {mode === "create" ? "Save template" : "Publish new version"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11"
                        onClick={() => setMode("details")}
                      >
                        Cancel editing
                      </Button>
                    </div>
                  </fieldset>
                </form>
              ) : selected ? (
                <>
                  <div>
                    <h3 className="break-words text-lg font-semibold">{selected.name}</h3>
                    {selected.description && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {selected.description}
                      </p>
                    )}
                  </div>
                  <label className="block text-sm">
                    Published version
                    <select
                      className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
                      value={selectedVersion}
                      disabled={busy || Boolean(pending)}
                      onChange={(event) => setSelectedVersion(Number(event.target.value))}
                    >
                      {selected.versions.map((version) => (
                        <option key={version.version} value={version.version}>
                          Version {version.version}
                          {version.version === selected.currentVersion ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {previewLoading && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Loading version {selectedVersion}…
                    </p>
                  )}
                  {previewError && (
                    <p role="alert" className="text-sm text-destructive">
                      {previewError}
                    </p>
                  )}
                  {outdated && (
                    <p role="status" className="text-sm text-muted-foreground">
                      The template changed. Refresh to use its latest permissions and revision.
                    </p>
                  )}
                  {preview && (
                    <div className="space-y-3 rounded-lg border p-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Project name</p>
                        <p className="break-words font-medium">{preview.snapshot.projectName}</p>
                      </div>
                      {preview.snapshot.projectDescription && (
                        <div>
                          <p className="text-xs text-muted-foreground">Description</p>
                          <p className="whitespace-pre-wrap break-words">
                            {preview.snapshot.projectDescription}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Instructions</p>
                        <p className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words">
                          {preview.snapshot.systemPrompt || "No instructions saved."}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Color: {preview.snapshot.color}
                      </p>
                    </div>
                  )}
                  {selected.archivedAt ? (
                    <p className="text-sm text-muted-foreground">
                      Archived. Published versions remain available to you; sharing and copying are
                      disabled.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="min-h-11"
                        disabled={locked || !canCopy || previewLoading}
                        onClick={() =>
                          mutate({
                            action: "copy",
                            templateId: selected.id,
                            version: selectedVersion,
                          })
                        }
                      >
                        <Copy className="mr-2 h-4 w-4" aria-hidden="true" /> Create project from v
                        {selectedVersion}
                      </Button>
                      {owner && (
                        <Button
                          variant="outline"
                          className="min-h-11"
                          disabled={locked || !preview || previewLoading}
                          onClick={() => {
                            if (preview) {
                              setDraft({ ...preview.snapshot });
                              setMode("publish");
                              setSuccess(null);
                              setError(null);
                            }
                          }}
                        >
                          Edit as new version
                        </Button>
                      )}
                    </div>
                  )}
                  {!owner && preview && !preview.canCopy && (
                    <p className="text-sm text-muted-foreground">
                      The owner shared this template for viewing only.
                    </p>
                  )}
                  {owner && (
                    <div className="space-y-4 border-t pt-4">
                      <h4 className="flex items-center gap-2 text-sm font-medium">
                        <Share2 className="h-4 w-4" aria-hidden="true" /> Sharing access
                      </h4>
                      {!selected.archivedAt && (
                        <form
                          className="space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!locked && canManage)
                              mutate({
                                action: "share",
                                templateId: selected.id,
                                expectedRevision: selected.revision,
                                granteeUserId: grantUserId.trim(),
                                canCopy: grantCanCopy,
                              });
                          }}
                        >
                          <label className="block text-sm">
                            Recipient account ID
                            <Input
                              className="mt-1"
                              value={grantUserId}
                              onChange={(event) => setGrantUserId(event.target.value)}
                              placeholder="Ask the recipient for their account ID"
                              maxLength={36}
                              required
                              disabled={locked || !canManage}
                            />
                          </label>
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={grantCanCopy}
                              onChange={(event) => setGrantCanCopy(event.target.checked)}
                              disabled={locked || !canManage}
                            />{" "}
                            Allow creating projects from this template
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Access includes all published versions. Saving an existing recipient
                            changes their permission.
                          </p>
                          <Button
                            type="submit"
                            variant="outline"
                            className="min-h-11"
                            disabled={
                              locked ||
                              !canManage ||
                              !grantUserId.trim() ||
                              grantUserId.trim() === userId
                            }
                          >
                            Save access
                          </Button>
                        </form>
                      )}
                      {selected.grants
                        .filter((grant) => !grant.revokedAt)
                        .map((grant) => (
                          <div
                            key={grant.granteeUserId}
                            className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="break-all text-xs">{grant.granteeUserId}</p>
                              <p className="text-xs text-muted-foreground">
                                {grant.canCopy ? "Can view and copy" : "Can view"}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              className="min-h-11"
                              disabled={locked || !canManage}
                              onClick={() =>
                                mutate({
                                  action: "revoke",
                                  templateId: selected.id,
                                  expectedRevision: selected.revision,
                                  granteeUserId: grant.granteeUserId,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        ))}
                      {selected.grants.every((grant) => grant.revokedAt) && (
                        <p className="text-sm text-muted-foreground">No active recipients.</p>
                      )}
                      {!selected.archivedAt && (
                        <Button
                          variant="ghost"
                          className="min-h-11 text-destructive"
                          disabled={locked || !canManage}
                          onClick={() => setArchiveTarget(selected)}
                        >
                          <Archive className="mr-2 h-4 w-4" aria-hidden="true" /> Archive template
                        </Button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Choose a saved template to inspect a version or create a project. Built-in
                  suggestions remain available in New project.
                </div>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(value) => {
          if (!value) setArchiveTarget(null);
        }}
        title="Archive this template?"
        description={`“${archiveTarget?.name ?? "This template"}” will stop accepting copies and all recipients will lose access. Published versions remain in your archive.`}
        confirmLabel="Archive template"
        destructive
        disabled={locked}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target)
            mutate({ action: "archive", templateId: target.id, expectedRevision: target.revision });
        }}
      />
    </>
  );
}
