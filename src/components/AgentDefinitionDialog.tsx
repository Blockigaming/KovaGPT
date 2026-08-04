import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  listSavedAgentVersions,
  restoreSavedAgentVersion,
  updateSavedAgent,
  type SavedAgent,
  type SavedAgentVersion,
} from "@/lib/agent-definitions.functions";

export function AgentDefinitionDialog({
  agent,
  mode,
  onClose,
  onSaved,
}: {
  agent: SavedAgent | null;
  mode: "edit" | "history" | null;
  onClose: () => void;
  onSaved: (agent: SavedAgent) => void;
}) {
  const update = useServerFn(updateSavedAgent);
  const listVersions = useServerFn(listSavedAgentVersions);
  const restore = useServerFn(restoreSavedAgentVersion);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tools, setTools] = useState("");
  const [memory, setMemory] = useState(false);
  const [versions, setVersions] = useState<SavedAgentVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setInstructions(agent.instructions);
    setProjectId(agent.project_id ?? "");
    setTools(agent.allowed_tools.join(", "));
    setMemory(agent.memory_enabled);
    if (mode === "history")
      listVersions({ data: { id: agent.id } })
        .then(setVersions)
        .catch(() => toast.error("Agent history could not be loaded"));
  }, [agent, listVersions, mode]);
  const toolList = useMemo(
    () => [
      ...new Set(
        tools
          .split(",")
          .map((tool) => tool.trim())
          .filter(Boolean),
      ),
    ],
    [tools],
  );
  const dirty = Boolean(
    agent &&
    (name.trim() !== agent.name ||
      instructions.trim() !== agent.instructions ||
      (projectId.trim() || null) !== agent.project_id ||
      toolList.join("|") !== agent.allowed_tools.join("|") ||
      memory !== agent.memory_enabled),
  );
  const requestClose = () => (mode === "edit" && dirty ? setDiscard(true) : onClose());
  const save = async () => {
    if (!agent || busy || !dirty) return;
    setBusy(true);
    try {
      const saved = await update({
        data: {
          id: agent.id,
          expectedVersion: agent.version,
          name,
          instructions,
          projectId: projectId || null,
          allowedTools: toolList,
          memoryEnabled: memory,
        },
      });
      onSaved(saved);
      toast.success("Agent changes saved");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent changes could not be saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog open={Boolean(agent && mode)} onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void save();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === "history" ? `Version history for ${agent?.name}` : `Edit ${agent?.name}`}
            </DialogTitle>
            <DialogDescription>
              {mode === "history"
                ? "Historical snapshots are immutable. Restoring creates a new version."
                : "Changes use optimistic concurrency so newer edits are never overwritten."}
            </DialogDescription>
          </DialogHeader>
          {mode === "edit" ? (
            <div className="grid gap-3">
              <label className="text-sm">
                Name
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
                />
              </label>
              <label className="text-sm">
                Instructions
                <textarea
                  value={instructions}
                  maxLength={12000}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="mt-1 min-h-32 w-full rounded-lg border bg-background p-3"
                />
              </label>
              <label className="text-sm">
                Project ID (optional)
                <input
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
                />
              </label>
              <label className="text-sm">
                Allowed tools, comma separated
                <input
                  value={tools}
                  onChange={(e) => setTools(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(e) => setMemory(e.target.checked)}
                />
                Enable isolated agent memory
              </label>
              <p role="status" className="text-xs text-muted-foreground">
                {dirty ? "Unsaved changes" : `Saved version ${agent?.version ?? ""}`}
              </p>
            </div>
          ) : (
            <ol className="max-h-[58dvh] space-y-2 overflow-y-auto" aria-label="Agent versions">
              {versions.map((version) => (
                <li key={version.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong>Version {version.version}</strong>
                    <span className="text-xs text-muted-foreground">
                      {version.source} · {new Date(version.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{version.instructions}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {version.allowed_tools.length} tools · Memory{" "}
                    {version.memory_enabled ? "enabled" : "disabled"}
                  </p>
                  {version.version === agent?.version ? (
                    <span className="mt-2 inline-block text-xs font-medium">Current version</span>
                  ) : (
                    <button
                      disabled={busy}
                      className="mt-2 min-h-10 rounded-lg border px-3 text-sm"
                      onClick={async () => {
                        if (!agent) return;
                        setBusy(true);
                        try {
                          const saved = await restore({
                            data: {
                              id: agent.id,
                              version: version.version,
                              expectedVersion: agent.version,
                            },
                          });
                          onSaved(saved);
                          toast.success(`Restored as version ${saved.version}`);
                          onClose();
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Version could not be restored",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Restore version {version.version}
                    </button>
                  )}
                </li>
              ))}
              {!versions.length ? (
                <li className="rounded-xl border p-4 text-sm text-muted-foreground">
                  No version history is available.
                </li>
              ) : null}
            </ol>
          )}
          {mode === "edit" ? (
            <DialogFooter>
              <button onClick={requestClose} className="min-h-10 rounded-lg border px-4">
                Cancel
              </button>
              <button
                disabled={busy || !dirty || !name.trim() || !instructions.trim()}
                onClick={() => void save()}
                className="min-h-10 rounded-lg bg-foreground px-4 text-background disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Discard agent changes?"
        description="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        onConfirm={onClose}
      />
    </>
  );
}
