export type LibraryDeleteTarget = {
  id: string;
  title: string;
  temporary?: boolean;
  item_type?: string;
  file_name?: string | null;
};

function retentionDuration(milliseconds: number) {
  for (const [unit, size] of [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ] as const) {
    if (milliseconds % size === 0) {
      const amount = milliseconds / size;
      return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
    }
  }
  return `${milliseconds / 1_000} seconds`;
}

/** Presentation only: execution still uses the shared chat Trash and Library APIs. */
export function libraryDeleteConfirmation(
  items: LibraryDeleteTarget[],
  retentionMs: number | null,
) {
  const chats = items.filter((item) => item.id.startsWith("chat:"));
  const temporary = chats.filter((item) => item.temporary).length;
  const recoverable = retentionMs && retentionMs > 0 ? chats.length - temporary : 0;
  const instant = chats.length - temporary - recoverable;
  const saved = items.length - chats.length;
  const single = items.length === 1;
  const title = single ? `“${items[0].title || "Untitled item"}”` : `${items.length} Library items`;
  const parts: string[] = [];
  if (!single) {
    const names = items.slice(0, 3).map((item) => `“${item.title || "Untitled item"}”`);
    parts.push(
      `Selected: ${names.join(", ")}${items.length > 3 ? `, and ${items.length - 3} more` : ""}.`,
    );
  }
  if (recoverable) {
    const subject = single ? "This chat" : `${recoverable} chat${recoverable === 1 ? "" : "s"}`;
    parts.push(
      `${subject} will move to Trash and can be restored for ${retentionDuration(retentionMs!)}, your current retention setting. After that, ${recoverable === 1 ? "it" : "they"} can no longer be restored.`,
    );
  }
  if (instant) {
    parts.push(
      `Trash retention is set to Instantly. ${single ? "This chat" : `${instant} chat${instant === 1 ? "" : "s"}`} will be permanently deleted after a separate confirmation and cannot be restored.`,
    );
  }
  if (temporary) {
    parts.push(
      `${single ? "This temporary chat" : `${temporary} temporary chat${temporary === 1 ? "" : "s"}`} will be permanently deleted after a separate confirmation. Temporary chats do not go to Trash and cannot be restored.`,
    );
  }
  if (saved) {
    const files = items.filter(
      (item) =>
        !item.id.startsWith("chat:") &&
        !item.id.startsWith("work:") &&
        (item.file_name || ["upload", "document", "image"].includes(item.item_type ?? "")),
    ).length;
    const other = saved - files;
    const subject = single
      ? items[0].id.startsWith("work:")
        ? "This saved Work item"
        : files
          ? "This Library file"
          : "This saved Library item"
      : [
          files ? `${files} Library file${files === 1 ? "" : "s"}` : "",
          other ? `${other} saved item${other === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" and ");
    parts.push(
      `${subject} will be permanently deleted when you continue. ${saved === 1 ? "It does" : "They do"} not go to Trash and cannot be restored.`,
    );
  }
  return {
    title:
      recoverable === items.length && items.length > 0
        ? `Move ${single ? title : `${items.length} chats`} to Trash?`
        : saved === items.length && items.length > 0
          ? `Delete ${title} permanently?`
          : `Delete ${title}?`,
    description: parts.join(" "),
    confirmLabel:
      recoverable === items.length && items.length > 0
        ? "Move to Trash"
        : saved === items.length && items.length > 0
          ? "Delete permanently"
          : saved > 0
            ? "Delete selected items"
            : "Continue",
  };
}
