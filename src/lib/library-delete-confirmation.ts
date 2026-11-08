export type LibraryDeleteTarget = {
  id: string;
  title: string;
  temporary?: boolean;
  item_type?: string;
  file_name?: string | null;
};

/** All removal is permanent; one confirmation covers the selected items. */
export function libraryDeleteConfirmation(
  items: LibraryDeleteTarget[],
  _legacyRetention?: number | null,
) {
  const single = items.length === 1;
  const title = single ? `“${items[0].title || "Untitled item"}”` : `${items.length} Library items`;
  return {
    title: `Delete ${title} permanently?`,
    description: `${single ? "This item" : "These items"} will be permanently deleted and cannot be restored.`,
    confirmLabel: "Delete permanently",
  };
}
