import type { ResponseFile } from "@/lib/response-files.mjs";
import type { ArtifactKind } from "@/components/artifact-utils";

/** Result-pane descriptor for a named file from a reply. */
export function fileResultDescriptor(messageId: string, file: ResponseFile) {
  const kind: ArtifactKind =
    file.language === "html" ? "website" : file.category === "Code" ? "code" : "writing";
  return {
    title: file.name,
    initialContent: file.content,
    kind,
    initialMode: "preview" as const,
    canvasSourceKey: `${messageId}:file:${file.name}`,
    file,
    // A file is a fragment of the reply: never autosave it over the whole message.
    chatId: null,
    messageId: null,
    projectId: null,
  };
}
