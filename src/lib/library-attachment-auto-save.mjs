const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createLibraryAttachmentAutoSaver({
  getScope,
  saveImage,
  saveText,
  saveDocument,
  onError,
}) {
  const pending = new Set();
  const completed = new Set();
  async function save(attachment, scope = getScope(), originalFile) {
    if (
      getScope() !== scope ||
      !scope.enabled ||
      !scope.principal ||
      attachment.status !== "complete" ||
      attachment.source !== "file_upload" ||
      !UUID.test(attachment.clientId ?? "") ||
      !["image", "text_file"].includes(attachment.kind)
    )
      return;
    const key = `${scope.principal}:${attachment.clientId}`;
    if (pending.has(key) || completed.has(key)) return;
    pending.add(key);
    try {
      if (originalFile) {
        if (!saveDocument) throw new Error("Original file saving is unavailable");
        await saveDocument(originalFile, attachment, scope);
      } else if (attachment.kind === "image") {
        await saveImage({
          data: {
            imageUrl: attachment.dataUrl,
            title: attachment.name.slice(0, 200),
            source: "upload",
            idempotencyKey: attachment.clientId,
          },
        });
      } else {
        await saveText({
          data: {
            title: attachment.name.slice(0, 200),
            item_type: "upload",
            source: "upload",
            content_text: attachment.textContent ?? "",
            file_name: attachment.name.slice(0, 300),
            file_type: (attachment.fileType || "text/plain").slice(0, 100),
            file_size: attachment.size,
            idempotencyKey: attachment.clientId,
          },
        });
      }
      completed.add(key);
      if (completed.size > 256) completed.delete(completed.values().next().value);
    } catch {
      if (getScope() === scope)
        onError(originalFile?.name ?? attachment.name, () => save(attachment, scope, originalFile));
    } finally {
      pending.delete(key);
    }
  }
  return save;
}
