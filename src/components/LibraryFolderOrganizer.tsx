import {
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Move,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createLibraryFolder,
  deleteLibraryFolder,
  listLibraryFolders,
  moveLibraryItems,
  renameLibraryFolder,
  type LibraryFolder,
} from "@/lib/library-folders";

export type LibraryFolderScope = "all" | "unfiled" | string;

const MAX_BULK_MOVE_ITEMS = 100;
const MAX_FOLDER_DEPTH = 12;

function folderDepth(folderId: string, folders: LibraryFolder[]): number {
  let current = folders.find((folder) => folder.id === folderId);
  let depth = 0;
  const seen = new Set<string>();
  while (current && !seen.has(current.id) && depth < MAX_FOLDER_DEPTH + 1) {
    seen.add(current.id);
    depth += 1;
    const parentId: string | null = current.parentId;
    current = parentId ? folders.find((folder) => folder.id === parentId) : undefined;
  }
  return depth;
}

function folderPath(folder: LibraryFolder, folders: LibraryFolder[]): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: LibraryFolder | undefined = folder;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    const parentId: LibraryFolder["parentId"] = current.parentId;
    current = parentId ? folders.find((candidate) => candidate.id === parentId) : undefined;
  }
  return names.join(" / ");
}

function descendantIds(folderId: string, folders: LibraryFolder[]): string[] {
  const found = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && found.has(folder.parentId) && !found.has(folder.id)) {
        found.add(folder.id);
        changed = true;
      }
    }
  }
  return [...found];
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Library organization is temporarily unavailable. Try again.";
}

export function LibraryFolderOrganizer({
  enabled,
  principalKey,
  refreshKey,
  itemStateUnavailable,
  scope,
  selectedItemIds,
  onScopeChange,
  onBusyChange,
  onRefresh,
  onMoved,
  onFoldersDeleted,
}: {
  enabled: boolean;
  principalKey: string;
  refreshKey: number;
  itemStateUnavailable: boolean;
  scope: LibraryFolderScope;
  selectedItemIds: string[];
  onScopeChange: (scope: LibraryFolderScope) => void;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => void;
  onMoved: (itemIds: string[], folderId: string | null) => void;
  onFoldersDeleted: (folderIds: string[]) => void;
}) {
  const generationRef = useRef(0);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"create" | "rename" | "delete" | "move" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"create" | "rename" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [moveTarget, setMoveTarget] = useState("root");

  useEffect(() => {
    onBusyChange(Boolean(busy));
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listLibraryFolders();
      if (generationRef.current !== generation) return;
      setFolders(next);
      setFoldersLoaded(true);
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(errorMessage(loadError));
      setFoldersLoaded(true);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    generationRef.current += 1;
    setFolders([]);
    setFoldersLoaded(false);
    setError(null);
    setEditor(null);
    setEditorError(null);
    setDeletePending(false);
    setMoveTarget("root");
    if (enabled) void load();
    return () => {
      generationRef.current += 1;
    };
  }, [enabled, load, principalKey, refreshKey]);

  useEffect(() => {
    if (
      foldersLoaded &&
      !loading &&
      !error &&
      scope !== "all" &&
      scope !== "unfiled" &&
      !folders.some((folder) => folder.id === scope)
    ) {
      onScopeChange("all");
    }
  }, [error, folders, foldersLoaded, loading, onScopeChange, scope]);

  useEffect(() => {
    if (
      foldersLoaded &&
      moveTarget !== "root" &&
      !folders.some((folder) => folder.id === moveTarget)
    ) {
      setMoveTarget("root");
    }
  }, [folders, foldersLoaded, moveTarget]);

  const folderStateUnavailable = loading || Boolean(error) || !foldersLoaded;
  const activeFolder =
    scope === "all" || scope === "unfiled"
      ? null
      : (folders.find((folder) => folder.id === scope) ?? null);
  const canCreateChild = !activeFolder || folderDepth(activeFolder.id, folders) < MAX_FOLDER_DEPTH;
  const sortedFolders = useMemo(
    () =>
      [...folders].sort(
        (left, right) =>
          left.position - right.position ||
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      ),
    [folders],
  );

  const submitEditor = async () => {
    const name = folderName.trim();
    if (!name || busy || folderStateUnavailable) return;
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy(editor);
    setError(null);
    setEditorError(null);
    try {
      if (editor === "create") {
        const created = await createLibraryFolder({
          name,
          parentId: activeFolder?.id ?? null,
        });
        if (!isCurrent()) return;
        setFolders((current) => [...current, created]);
        onScopeChange(created.id);
        toast.success("Folder created.");
      } else if (editor === "rename" && activeFolder) {
        const renamed = await renameLibraryFolder({ id: activeFolder.id, name });
        if (!isCurrent()) return;
        setFolders((current) =>
          current.map((folder) => (folder.id === renamed.id ? renamed : folder)),
        );
        toast.success("Folder renamed.");
      }
      setEditor(null);
      setFolderName("");
    } catch (mutationError) {
      if (isCurrent()) setEditorError(errorMessage(mutationError));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const removeFolder = async () => {
    if (!activeFolder || busy || folderStateUnavailable || itemStateUnavailable) return;
    const removedIds = descendantIds(activeFolder.id, folders);
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy("delete");
    setError(null);
    try {
      const result = await deleteLibraryFolder(activeFolder.id);
      if (!isCurrent()) return;
      setFolders((current) => current.filter((folder) => !removedIds.includes(folder.id)));
      onFoldersDeleted(removedIds);
      onScopeChange("all");
      toast.success(
        result.movedToRootCount
          ? `Folder removed. ${result.movedToRootCount} item${
              result.movedToRootCount === 1 ? "" : "s"
            } moved to Unfiled.`
          : "Folder removed.",
      );
    } catch (mutationError) {
      if (isCurrent()) setError(errorMessage(mutationError));
    } finally {
      if (isCurrent()) {
        setBusy(null);
        setDeletePending(false);
      }
    }
  };

  const moveSelected = async () => {
    if (
      busy ||
      folderStateUnavailable ||
      itemStateUnavailable ||
      selectedItemIds.length === 0 ||
      selectedItemIds.length > MAX_BULK_MOVE_ITEMS
    ) {
      return;
    }
    const folderId = moveTarget === "root" ? null : moveTarget;
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy("move");
    setError(null);
    try {
      await moveLibraryItems({ itemIds: selectedItemIds, folderId });
      if (!isCurrent()) return;
      onMoved(selectedItemIds, folderId);
      toast.success(
        `${selectedItemIds.length} item${selectedItemIds.length === 1 ? "" : "s"} moved.`,
      );
    } catch (mutationError) {
      if (isCurrent()) setError(errorMessage(mutationError));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const renderFolders = (parentId: string | null, depth = 0): ReactNode =>
    sortedFolders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => (
        <div key={folder.id}>
          <button
            type="button"
            aria-current={scope === folder.id ? "page" : undefined}
            onClick={() => onScopeChange(folder.id)}
            className={`flex min-h-11 w-full items-center gap-2 rounded-lg pr-3 text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
              scope === folder.id ? "bg-[var(--surface-selected)] font-medium" : ""
            }`}
            style={{
              paddingLeft: `${Math.min(depth, MAX_FOLDER_DEPTH - 1) * 16 + 12}px`,
            }}
          >
            <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{folder.name}</span>
          </button>
          {renderFolders(folder.id, depth + 1)}
        </div>
      ));

  if (!enabled) return null;

  return (
    <section className="kova-card space-y-3 p-3 sm:p-4" aria-labelledby="library-folders-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="library-folders-title" className="text-sm font-medium">
            Folders
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Organize durable Library items. Deleting a folder keeps its contents.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={Boolean(busy) || folderStateUnavailable || !canCreateChild}
            onClick={() => {
              setFolderName("");
              setEditorError(null);
              setEditor("create");
            }}
          >
            <FolderPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            {activeFolder ? "New subfolder" : "New folder"}
          </Button>
          {activeFolder ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={Boolean(busy) || folderStateUnavailable}
                onClick={() => {
                  setFolderName(activeFolder.name);
                  setEditorError(null);
                  setEditor("rename");
                }}
              >
                <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                Rename
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 text-destructive"
                disabled={Boolean(busy) || folderStateUnavailable || itemStateUnavailable}
                onClick={() => setDeletePending(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button size="sm" variant="outline" className="min-h-11" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      <nav aria-label="Library folders" className="max-h-64 overflow-y-auto rounded-xl border p-1">
        <button
          type="button"
          aria-current={scope === "all" ? "page" : undefined}
          onClick={() => onScopeChange("all")}
          className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
            scope === "all" ? "bg-[var(--surface-selected)] font-medium" : ""
          }`}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          All items
        </button>
        <button
          type="button"
          aria-current={scope === "unfiled" ? "page" : undefined}
          onClick={() => onScopeChange("unfiled")}
          className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
            scope === "unfiled" ? "bg-[var(--surface-selected)] font-medium" : ""
          }`}
        >
          <Folder className="h-4 w-4" aria-hidden="true" />
          Unfiled
        </button>
        {loading && folders.length === 0 ? (
          <p
            role="status"
            className="flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground"
          >
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading folders…
          </p>
        ) : (
          renderFolders(null)
        )}
      </nav>

      {selectedItemIds.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-3">
          <label className="min-w-52 flex-1 text-xs font-medium">
            Move {selectedItemIds.length} selected item
            {selectedItemIds.length === 1 ? "" : "s"} to
            <select
              className="kova-select mt-1 min-h-11 w-full"
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value)}
              disabled={Boolean(busy) || folderStateUnavailable || itemStateUnavailable}
            >
              <option value="root">Unfiled</option>
              {sortedFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderPath(folder, folders)}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="min-h-11"
            size="sm"
            disabled={
              Boolean(busy) ||
              folderStateUnavailable ||
              itemStateUnavailable ||
              selectedItemIds.length > MAX_BULK_MOVE_ITEMS
            }
            onClick={() => void moveSelected()}
          >
            {busy === "move" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Move className="mr-2 h-4 w-4" />
            )}
            Move
          </Button>
          {selectedItemIds.length > MAX_BULK_MOVE_ITEMS ? (
            <p className="w-full text-xs text-destructive" role="alert">
              Select no more than 100 durable items for one move.
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        {editor ? (
          <DialogContent>
            <DialogTitle>
              {editor === "create" ? "Create Library folder" : "Rename folder"}
            </DialogTitle>
            <DialogDescription>
              {editor === "create" && activeFolder
                ? `Create a folder inside ${activeFolder.name}.`
                : "Folder names can contain up to 120 characters."}
            </DialogDescription>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEditor();
              }}
            >
              <label className="block text-sm font-medium">
                Folder name
                <Input
                  autoFocus
                  className="mt-1 h-11"
                  maxLength={120}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
              </label>
              {editorError ? (
                <p role="alert" className="text-sm text-destructive">
                  {editorError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={Boolean(busy)}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={!folderName.trim() || Boolean(busy)}
                >
                  {busy ? "Saving…" : editor === "create" ? "Create" : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <ConfirmActionDialog
        open={deletePending}
        onOpenChange={(open) => !open && !busy && setDeletePending(false)}
        title="Delete this Library folder?"
        description="The folder and its subfolders will be removed. Their Library items will be kept and moved to Unfiled."
        confirmLabel="Delete folder"
        destructive
        onConfirm={() => void removeFolder()}
      />
    </section>
  );
}
