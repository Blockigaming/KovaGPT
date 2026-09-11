import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { parseWorkflowSkillMutationResult } from "@/lib/workflow-skills-client.mjs";
import {
  createWorkflowSkill,
  createWorkflowSkillVersion,
  deleteWorkflowSkill,
  installWorkflowSkillVersion,
  listWorkflowSkills,
  uninstallWorkflowSkill,
  type WorkflowSkillCard,
} from "@/lib/workflow-skills.functions";
import { safeBrowserStorage, writePrincipalHandoff } from "@/lib/principal-browser-storage.mjs";
import type { WorkflowSkillDraft } from "@/lib/workflow-skills-policy.mjs";

const emptyDraft = (): WorkflowSkillDraft => ({
  name: "",
  description: "",
  instructions: "",
  resources: [],
});

function mutationEnvelope() {
  return { mutationId: crypto.randomUUID(), requestedAt: new Date().toISOString() };
}

type MutationEnvelope = ReturnType<typeof mutationEnvelope>;

export function WorkflowSkillsPanel({ userKey }: { userKey: string }) {
  const list = useServerFn(listWorkflowSkills);
  const create = useServerFn(createWorkflowSkill);
  const version = useServerFn(createWorkflowSkillVersion);
  const install = useServerFn(installWorkflowSkillVersion);
  const uninstall = useServerFn(uninstallWorkflowSkill);
  const remove = useServerFn(deleteWorkflowSkill);
  const [skills, setSkills] = useState<WorkflowSkillCard[] | null>(null);
  const [draft, setDraft] = useState<WorkflowSkillDraft>(emptyDraft);
  const [editing, setEditing] = useState<WorkflowSkillCard | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSkillCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const retryEnvelopes = useRef(new Map<string, MutationEnvelope>());

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const result = await list();
      // Unserialized server-function failures can resolve as JSON error objects.
      // Keep them out of list state so this panel cannot crash the Apps page.
      if (!Array.isArray(result)) throw new Error("Invalid workflow skill list response.");
      setSkills(result);
    } catch {
      setLoadError(true);
    }
  }, [list]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mutate = async (
    retryKey: string,
    action: (envelope: MutationEnvelope) => Promise<unknown>,
    success: string,
  ) => {
    if (busy) return false;
    setBusy(true);
    let envelope = retryEnvelopes.current.get(retryKey);
    if (!envelope) {
      if (retryEnvelopes.current.size >= 32) retryEnvelopes.current.clear();
      envelope = mutationEnvelope();
      retryEnvelopes.current.set(retryKey, envelope);
    }
    try {
      const result = await action(envelope);
      parseWorkflowSkillMutationResult(result);
      retryEnvelopes.current.delete(retryKey);
      await reload();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workflow skill could not be updated.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    const current = editing;
    const retryKey = JSON.stringify([
      current ? "version" : "create",
      current?.id ?? null,
      current?.revision ?? null,
      draft,
    ]);
    const saved = await mutate(
      retryKey,
      (envelope) =>
        current
          ? version({
              data: {
                ...envelope,
                id: current.id,
                expectedRevision: current.revision,
                draft,
              },
            })
          : create({ data: { ...envelope, draft } }),
      current ? "New workflow skill version saved" : "Workflow skill created and installed",
    );
    if (saved) {
      setEditing(null);
      setEditorOpen(false);
      setDraft(emptyDraft());
    }
  };

  const openEditor = (skill?: WorkflowSkillCard) => {
    setEditing(skill ?? null);
    setEditorOpen(true);
    setDraft(
      skill
        ? {
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            resources: skill.resources.map((resource) => ({ ...resource })),
          }
        : emptyDraft(),
    );
  };

  const openChatWithSkill = (skill: WorkflowSkillCard) => {
    if (!skill.installationId || !skill.installedVersionId) return;
    const handoff = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-workflow-skill-chat",
      userKey,
      {
        installationId: skill.installationId,
        versionId: skill.installedVersionId,
        name: skill.installedName ?? skill.name,
      },
    );
    if (!handoff.ok) {
      toast.error("Workflow skill selection could not be prepared. Reload and try again.");
      return;
    }
    window.location.href = "/";
  };

  return (
    <section aria-labelledby="workflow-skills-title" className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="workflow-skills-title" className="flex items-center gap-2 font-semibold">
            <BookOpen className="h-4 w-4" aria-hidden="true" /> Workflow skills
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Save reusable instructions and reference resources. Chat resolves only your installed,
            exact version. Skill text cannot grant tools, credentials, account access, or model
            access.
          </p>
        </div>
        <Button variant="outline" onClick={() => openEditor()} disabled={busy}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New skill
        </Button>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          Workflow skills could not be loaded. Your installations were not changed.
          <Button variant="outline" size="sm" className="ml-3" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : skills === null ? (
        <div
          className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          role="status"
          aria-label="Loading workflow skills"
        />
      ) : skills.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
          No workflow skills yet. Create one to reuse a trusted process without copying its text
          into every chat.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {skills.map((skill) => {
            const installed = skill.installedVersionId === skill.headVersionId;
            return (
              <li key={skill.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{skill.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Version {skill.version}
                      {installed
                        ? " · installed"
                        : skill.installationId
                          ? " · update available"
                          : ""}
                    </p>
                  </div>
                  {installed ? (
                    <Check className="h-4 w-4 text-emerald-500" aria-label="Installed" />
                  ) : null}
                </div>
                {skill.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {skill.description}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {skill.installationId ? (
                    <Button size="sm" onClick={() => openChatWithSkill(skill)} disabled={busy}>
                      Use installed v{skill.installedVersion}
                    </Button>
                  ) : null}
                  {!installed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          JSON.stringify([
                            "install",
                            skill.id,
                            skill.revision,
                            skill.headVersionId,
                          ]),
                          (envelope) =>
                            install({
                              data: {
                                ...envelope,
                                id: skill.id,
                                expectedRevision: skill.revision,
                                versionId: skill.headVersionId,
                              },
                            }),
                          `Installed ${skill.name} version ${skill.version}`,
                        )
                      }
                    >
                      {skill.installationId ? "Install update" : "Install"}
                    </Button>
                  ) : null}
                  {skill.installationId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          JSON.stringify(["uninstall", skill.id, skill.revision]),
                          (envelope) =>
                            uninstall({
                              data: {
                                ...envelope,
                                id: skill.id,
                                expectedRevision: skill.revision,
                              },
                            }),
                          `Uninstalled ${skill.name}`,
                        )
                      }
                    >
                      Uninstall
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openEditor(skill)}
                  >
                    New version
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Delete ${skill.name}`}
                    onClick={() => setDeleteTarget(skill)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editorOpen && (
        <form
          className="space-y-3 rounded-xl border bg-muted/20 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitDraft();
          }}
        >
          <h3 className="font-medium">
            {editing ? `New ${editing.name} version` : "New workflow skill"}
          </h3>
          <label className="block text-sm font-medium">
            Name
            <Input
              className="mt-1"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className="block text-sm font-medium">
            Description
            <Input
              className="mt-1"
              maxLength={500}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <label className="block text-sm font-medium">
            Workflow instructions
            <Textarea
              className="mt-1 min-h-32"
              required
              maxLength={12000}
              value={draft.instructions}
              onChange={(event) =>
                setDraft((current) => ({ ...current, instructions: event.target.value }))
              }
            />
          </label>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Reference resources</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={draft.resources.length >= 10}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    resources: [...current.resources, { title: "", content: "" }],
                  }))
                }
              >
                Add resource
              </Button>
            </div>
            {draft.resources.map((resource, index) => (
              <fieldset key={index} className="space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-xs text-muted-foreground">Resource {index + 1}</legend>
                <Input
                  aria-label={`Resource ${index + 1} title`}
                  required
                  maxLength={120}
                  placeholder="Title"
                  value={resource.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      resources: current.resources.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, title: event.target.value } : item,
                      ),
                    }))
                  }
                />
                <Textarea
                  aria-label={`Resource ${index + 1} content`}
                  required
                  maxLength={8000}
                  placeholder="Reference content"
                  value={resource.content}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      resources: current.resources.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, content: event.target.value } : item,
                      ),
                    }))
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      resources: current.resources.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  Remove resource
                </Button>
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setEditorOpen(false);
                setDraft(emptyDraft());
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save new version" : "Create and install"}
            </Button>
          </div>
        </form>
      )}

      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "workflow skill"}?`}
        description="This removes every version and disables it in chats. This action cannot be undone."
        confirmLabel="Delete skill"
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void mutate(
            JSON.stringify(["delete", target.id, target.revision]),
            (envelope) =>
              remove({
                data: {
                  ...envelope,
                  id: target.id,
                  expectedRevision: target.revision,
                },
              }),
            `Deleted ${target.name}`,
          );
        }}
      />
    </section>
  );
}
