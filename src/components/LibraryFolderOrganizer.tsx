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
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { Input } from "@/components/ui/input";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
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
  ownerId,
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
  ownerId: string;
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
  const requestControllerRef = useRef<AbortController | null>(null);
  const deleteReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    principal: string;
    refresh: number;
  } | null>(null);
  const deleteConfirmedRef = useRef(false);
  const allItemsButtonRef = useRef<HTMLButtonElement>(null);
  const editorReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    principal: string;
    refresh: number;
    folderId?: string;
  } | null>(null);
  const editorContextRef = useRef({ enabled, principalKey, ownerId, refreshKey });
  editorContextRef.current = { enabled, principalKey, ownerId, refreshKey };
  const editorContentRef = useRef<HTMLDivElement>(null);
  const folderButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const unfiledButtonRef = useRef<HTMLButtonElement>(null);
  const moveReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    principal: string;
    refresh: number;
    folderId: string | null;
  } | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"create" | "rename" | "delete" | "move" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"create" | "rename" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [deletePending, setDeletePending] = useState<LibraryFolder | null>(null);
  const [moveTarget, setMoveTarget] = useState("root");

  useEffect(() => {
    onBusyChange(Boolean(busy));
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const load = useCallback(async () => {
    const controller = requestControllerRef.current;
    if (!enabled || !controller || controller.signal.aborted) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listLibraryFolders(ownerId, controller.signal);
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
  }, [enabled, ownerId]);

  useEffect(() => {
    const resetState = () => {
      generationRef.current += 1;
      deleteReturnRef.current = null;
      deleteConfirmedRef.current = false;
      editorReturnRef.current = null;
      moveReturnRef.current = null;
      setFolders([]);
      setFoldersLoaded(false);
      setLoading(false);
      setError(null);
      setEditor(null);
      setEditorError(null);
      setDeletePending(null);
      setBusy(null);
      setMoveTarget("root");
    };
    resetState();
    const lifetime = createWorkViewLifetime(ownerId, resetState);
    requestControllerRef.current = lifetime.controller;
    if (enabled) void load();
    return () => {
      lifetime.dispose();
      if (requestControllerRef.current === lifetime.controller) requestControllerRef.current = null;
      deleteReturnRef.current = null;
      deleteConfirmedRef.current = false;
      editorReturnRef.current = null;
      moveReturnRef.current = null;
      generationRef.current += 1;
    };
  }, [enabled, load, ownerId, principalKey, refreshKey]);

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
    const controller = requestControllerRef.current;
    if (!name || busy || folderStateUnavailable || !controller || controller.signal.aborted) return;
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy(editor);
    setError(null);
    setEditorError(null);
    try {
      if (editor === "create") {
        const created = await createLibraryFolder(
          ownerId,
          { name, parentId: activeFolder?.id ?? null },
          controller.signal,
        );
        if (!isCurrent()) return;
        if (editorReturnRef.current) editorReturnRef.current.folderId = created.id;
        setFolders((current) => [...current, created]);
        onScopeChange(created.id);
        toast.success("Folder created.");
      } else if (editor === "rename" && activeFolder) {
        const renamed = await renameLibraryFolder(
          ownerId,
          { id: activeFolder.id, name },
          controller.signal,
        );
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
    const target = deletePending;
    const controller = requestControllerRef.current;
    if (
      !target ||
      busy ||
      folderStateUnavailable ||
      itemStateUnavailable ||
      !controller ||
      controller.signal.aborted
    )
      return;
    const removedIds = descendantIds(target.id, folders);
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy("delete");
    setError(null);
    try {
      const result = await deleteLibraryFolder(ownerId, target.id, controller.signal);
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
        setDeletePending(null);
      }
    }
  };

  useEffect(() => {
    const origin = moveReturnRef.current;
    if (busy || !origin) return;
    moveReturnRef.current = null;
    const context = editorContextRef.current;
    const active = document.activeElement;
    restoreDialogFocus(
      origin.folderId ? folderButtonsRef.current.get(origin.folderId) : unfiledButtonRef.current,
      origin.url,
      (active !== null && active !== document.body && active !== origin.trigger) ||
        !context.enabled ||
        origin.principal !== context.principalKey ||
        origin.refresh !== context.refreshKey,
    );
  }, [busy, selectedItemIds]);

  const moveContextIsCurrent = () => {
    const context = editorContextRef.current;
    return (
      context.enabled &&
      context.principalKey === principalKey &&
      context.ownerId === ownerId &&
      context.refreshKey === refreshKey
    );
  };

  const moveSelected = async (trigger: HTMLButtonElement) => {
    const controller = requestControllerRef.current;
    if (
      !controller ||
      controller.signal.aborted ||
      busy ||
      folderStateUnavailable ||
      itemStateUnavailable ||
      !moveContextIsCurrent() ||
      (moveTarget !== "root" && !folders.some((folder) => folder.id === moveTarget)) ||
      selectedItemIds.length === 0 ||
      selectedItemIds.length > MAX_BULK_MOVE_ITEMS
    ) {
      return;
    }
    const folderId = moveTarget === "root" ? null : moveTarget;
    const origin = {
      trigger,
      url: window.location.href,
      principal: principalKey,
      refresh: refreshKey,
      folderId,
    };
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setLoading(false);
    setBusy("move");
    setError(null);
    try {
      await moveLibraryItems(ownerId, { itemIds: selectedItemIds, folderId }, controller.signal);
      if (!isCurrent()) return;
      // Only restore when this request still owns focus at completion.
      if (document.activeElement === trigger || document.activeElement === document.body)
        moveReturnRef.current = origin;
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
          <Button
            data-ui-reference="chatgpt.library-folders.control"
            variant="ghost"
            type="button"
            ref={(node) => {
              if (node) folderButtonsRef.current.set(folder.id, node);
              else folderButtonsRef.current.delete(folder.id);
            }}
            aria-current={scope === folder.id ? "page" : undefined}
            onClick={() => onScopeChange(folder.id)}
            className={`h-auto min-h-9 whitespace-normal rounded-[var(--kova-radius-compact)] py-2.5 flex  w-full items-center gap-2  pr-3 text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
              scope === folder.id ? "bg-[var(--surface-selected)] font-medium" : ""
            }`}
            style={{
              paddingLeft: `${Math.min(depth, MAX_FOLDER_DEPTH - 1) * 16 + 12}px`,
            }}
          >
            <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{folder.name}</span>
          </Button>
          {renderFolders(folder.id, depth + 1)}
        </div>
      ));

  if (!enabled) return null;

  return (
    <section
      data-ui-reference="chatgpt.library-folders.section"
      className="kova-card space-y-3 p-3 sm:p-4"
      aria-labelledby="library-folders-title"
    >
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
            data-ui-reference="chatgpt.library-folders.control"
            size="sm"
            variant="outline"
            className=""
            disabled={Boolean(busy) || folderStateUnavailable || !canCreateChild}
            onClick={(event) => {
              editorReturnRef.current = {
                trigger: event.currentTarget,
                url: window.location.href,
                principal: principalKey,
                refresh: refreshKey,
              };
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
                data-ui-reference="chatgpt.library-folders.control"
                size="sm"
                variant="outline"
                className=""
                disabled={Boolean(busy) || folderStateUnavailable}
                onClick={(event) => {
                  editorReturnRef.current = {
                    trigger: event.currentTarget,
                    url: window.location.href,
                    principal: principalKey,
                    refresh: refreshKey,
                  };
                  setFolderName(activeFolder.name);
                  setEditorError(null);
                  setEditor("rename");
                }}
              >
                <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                Rename
              </Button>
              <Button
                data-ui-reference="chatgpt.library-folders.control"
                size="sm"
                variant="outline"
                className=" text-destructive"
                disabled={Boolean(busy) || folderStateUnavailable || itemStateUnavailable}
                onClick={(event) => {
                  deleteReturnRef.current = {
                    trigger: event.currentTarget,
                    url: window.location.href,
                    principal: principalKey,
                    refresh: refreshKey,
                  };
                  deleteConfirmedRef.current = false;
                  setDeletePending(activeFolder);
                }}
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
          <Button
            data-ui-reference="chatgpt.library-folders.control"
            size="sm"
            variant="outline"
            className=""
            onClick={onRefresh}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      <nav
        data-ui-reference="chatgpt.library-folders.nav"
        aria-label="Library folders"
        className="max-h-64 overflow-y-auto rounded-xl border p-1"
      >
        <Button
          data-ui-reference="chatgpt.library-folders.control"
          variant="ghost"
          type="button"
          ref={allItemsButtonRef}
          aria-current={scope === "all" ? "page" : undefined}
          onClick={() => onScopeChange("all")}
          className={`h-auto min-h-9 whitespace-normal rounded-[var(--kova-radius-compact)] py-2.5 flex  w-full items-center gap-2   text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
            scope === "all" ? "bg-[var(--surface-selected)] font-medium" : ""
          }`}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          All items
        </Button>
        <Button
          data-ui-reference="chatgpt.library-folders.control"
          variant="ghost"
          type="button"
          ref={unfiledButtonRef}
          aria-current={scope === "unfiled" ? "page" : undefined}
          onClick={() => onScopeChange("unfiled")}
          className={`h-auto min-h-9 whitespace-normal rounded-[var(--kova-radius-compact)] py-2.5 flex  w-full items-center gap-2   text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring ${
            scope === "unfiled" ? "bg-[var(--surface-selected)] font-medium" : ""
          }`}
        >
          <Folder className="h-4 w-4" aria-hidden="true" />
          Unfiled
        </Button>
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
            <SearchablePicker
              className="kova-select mt-1 min-h-11 w-full"
              aria-label="Move selected Library items to folder"
              value={moveTarget === "root" ? "" : moveTarget}
              placeholder="Unfiled"
              searchLabel="Search folders"
              emptyText="No folders match your search."
              options={sortedFolders.map((folder) => ({
                value: folder.id,
                label: folderPath(folder, folders),
              }))}
              onValueChange={(value) => {
                const controller = requestControllerRef.current;
                if (
                  !moveContextIsCurrent() ||
                  !controller ||
                  controller.signal.aborted ||
                  busy ||
                  folderStateUnavailable ||
                  itemStateUnavailable ||
                  (value !== "" && !folders.some((folder) => folder.id === value))
                )
                  return;
                setMoveTarget(value || "root");
              }}
              disabled={Boolean(busy) || folderStateUnavailable || itemStateUnavailable}
            />
          </label>
          <Button
            data-ui-reference="chatgpt.library-folders.control"
            className=""
            size="sm"
            disabled={
              Boolean(busy) ||
              folderStateUnavailable ||
              itemStateUnavailable ||
              selectedItemIds.length > MAX_BULK_MOVE_ITEMS
            }
            onClick={(event) => void moveSelected(event.currentTarget)}
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
          <DialogContent
            data-ui-reference="chatgpt.library-folders.dialogcontent"
            ref={editorContentRef}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = editorReturnRef.current;
              editorReturnRef.current = null;
              const context = editorContextRef.current;
              const active = document.activeElement;
              // A later interaction or navigation owns focus, including account resets.
              const focusMoved =
                active !== null &&
                active !== document.body &&
                !editorContentRef.current?.contains(active);
              restoreDialogFocus(
                origin?.folderId ? folderButtonsRef.current.get(origin.folderId) : origin?.trigger,
                origin?.url,
                focusMoved ||
                  !context.enabled ||
                  origin?.principal !== context.principalKey ||
                  origin?.refresh !== context.refreshKey,
              );
            }}
          >
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
                  data-ui-reference="chatgpt.library-folders.input"
                  autoFocus
                  className="mt-1 "
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
                  data-ui-reference="chatgpt.library-folders.control"
                  type="button"
                  variant="ghost"
                  className=""
                  disabled={Boolean(busy)}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </Button>
                <Button
                  data-ui-reference="chatgpt.library-folders.control"
                  type="submit"
                  className=""
                  disabled={!folderName.trim() || Boolean(busy)}
                >
                  {busy ? (
                    <span className="spec400-loading-label">
                      <span className="spec400-loading-spinner" aria-hidden="true" />
                      Saving…
                    </span>
                  ) : editor === "create" ? (
                    "Create"
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <ConfirmActionDialog
        open={deletePending !== null}
        onOpenChange={(open) => !open && setDeletePending(null)}
        title={deletePending ? `Delete “${deletePending.name}” folder?` : "Delete Library folder?"}
        description="The folder and its subfolders will be removed. Their Library items will be kept and moved to Unfiled."
        confirmLabel="Delete folder"
        destructive
        disabled={Boolean(busy) || folderStateUnavailable || itemStateUnavailable || !deletePending}
        onConfirm={() => {
          if (busy || folderStateUnavailable || itemStateUnavailable || !deletePending) return;
          deleteConfirmedRef.current = true;
          void removeFolder();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const origin = deleteReturnRef.current;
          const confirmed = deleteConfirmedRef.current;
          deleteReturnRef.current = null;
          deleteConfirmedRef.current = false;
          const context = editorContextRef.current;
          const active = document.activeElement;
          const focusMoved =
            active !== null &&
            active !== document.body &&
            active !== origin?.trigger &&
            !(event.target instanceof HTMLElement && event.target.contains(active));
          const trigger = origin?.trigger;
          const canReturn =
            trigger?.isConnected &&
            trigger.getClientRects().length > 0 &&
            !trigger.closest('[inert], [aria-hidden="true"]') &&
            !trigger.matches(":disabled");
          restoreDialogFocus(
            !confirmed && canReturn ? trigger : allItemsButtonRef.current,
            origin?.url,
            focusMoved ||
              !context.enabled ||
              origin?.principal !== context.principalKey ||
              origin?.refresh !== context.refreshKey,
          );
        }}
      />
    </section>
  );
}
