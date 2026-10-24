import type { Attachment, Conversation } from "./chat-store";
import {
  detectArtifactKind,
  extractCodeBlocks,
  type ArtifactKind,
} from "../components/artifact-utils";
import { safeImageUrl } from "./safe-image-url";

export type ConversationOutput = {
  id: string;
  messageId: string;
  name: string;
  label: string;
} & (
  | { kind: "text"; content: string; downloadName: string; extracted: boolean }
  | { kind: "image"; source: string | null; downloadName: string }
  | { kind: "library"; libraryItemId: string }
  | { kind: "artifact"; content: string; artifactKind: ArtifactKind; downloadName: string }
);

function fileName(value: string) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "attachment.txt";
}

function attachmentOutput(
  attachment: Attachment,
  messageId: string,
  index: number,
): ConversationOutput {
  const base = { id: `${messageId}:attachment:${index}`, messageId };
  if (attachment.kind === "image") {
    const source = safeImageUrl(attachment.dataUrl);
    return {
      ...base,
      kind: "image",
      name: `Image ${index + 1}`,
      label: "Image",
      source,
      downloadName: `image-${index + 1}.${source?.match(/^data:image\/(\w+)/)?.[1] ?? "png"}`,
    };
  }
  if (attachment.kind === "library_file")
    return {
      ...base,
      kind: "library",
      name: attachment.name,
      label: "Library file",
      libraryItemId: attachment.libraryItemId,
    };
  // Office and PDF attachments retain extracted text, never the original binary.
  const extracted =
    !/\.(?:txt|md|csv|tsv|json|ya?ml|xml|html?|css|[cm]?jsx?|tsx?|py|rb|go|rs|sh|sql|log)$/i.test(
      attachment.name,
    );
  return {
    ...base,
    kind: "text",
    name: attachment.name,
    label: "File",
    content: attachment.content,
    extracted,
    downloadName: fileName(extracted ? `${attachment.name}.txt` : attachment.name),
  };
}

/** Derive only from this conversation; never invent Library files or completed outputs. */
export function conversationOutputs(conversation: Conversation): ConversationOutput[] {
  const outputs: ConversationOutput[] = [];
  for (const message of conversation.messages) {
    message.attachments?.forEach((attachment, index) =>
      outputs.push(attachmentOutput(attachment, message.id, index)),
    );
    if (message.role !== "assistant" || message.generationStatus || message.pendingImage) continue;
    const kind = detectArtifactKind(message.content || "");
    if (!kind) continue;
    const blocks = kind === "writing" ? [] : extractCodeBlocks(message.content);
    const content =
      blocks.length > 1
        ? blocks.map((block, index) => `// --- Block ${index + 1} ---\n${block}`).join("\n\n")
        : (blocks[0] ?? message.content);
    const name = `${kind === "writing" ? "Writing" : kind === "website" ? "Website" : "Code"} · ${conversation.title || "Untitled chat"}`;
    outputs.push({
      id: `${message.id}:artifact`,
      messageId: message.id,
      kind: "artifact",
      artifactKind: kind,
      content,
      name,
      label: "Artifact",
      downloadName: fileName(
        `${conversation.title || "output"}.${kind === "writing" ? "md" : "txt"}`,
      ),
    });
  }
  return outputs;
}
