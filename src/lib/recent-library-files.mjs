/** Load attachment suggestions only for a signed-in Library, outside initial chat code. */
export async function loadRecentLibraryFileOptions(savedChatLabel) {
  const { listMyLibrary } = await import("./library.functions");
  return (await listMyLibrary())
    .filter((item) => item.file_name || item.content_text || item.file_type)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.title,
      fileName: item.file_name || item.title,
      fileType: item.file_type || item.item_type,
      fileSize: item.file_size,
      createdAt: item.created_at,
      projectName: item.source === "chat" ? savedChatLabel : null,
    }));
}
