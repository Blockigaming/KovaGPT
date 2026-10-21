import type { Activity, Attachment, Conversation } from "./chat-store";
import {
  normalizeMemorySources,
  type MemorySourceRef,
  type MemorySources,
} from "./memory-sources.mjs";
import { normalizeResponseSources, type ResponseSource } from "./response-sources";

export type ConversationWebSource = {
  id: string;
  kind: "web";
  source: ResponseSource;
  messageIds: string[];
  /** Recorded response context, not proof of a particular citation or claim. */
  usage: "provided";
};

export type ConversationMemorySource = {
  id: string;
  kind: "memory";
  name: string;
  source: MemorySourceRef;
  /** Suitable for the existing owner-authorized MemorySourcesDialog. */
  sources: MemorySources;
  ownerId: string;
  messageIds: string[];
  /** The request included this reference; influence on the answer is unknown. */
  usage: "provided";
};

export type ConversationAttachmentSource = {
  id: string;
  kind: "attachment";
  name: string;
  messageId: string;
  attachmentIndex: number;
  /** Reuses the real conversationOutputs preview, without copying file contents. */
  outputId: string;
  attachmentKind: Attachment["kind"];
  /** Presence in the chat does not prove that the model read the attachment. */
  usage: "available";
};

export type ConversationBrowserSource = {
  id: string;
  kind: "browser";
  messageId: string;
  /** Exact browser action from the existing work execution protocol. */
  tool: "browser_interact";
  label: string;
  /** Recorded activity state, never a browser connection/readiness claim. */
  status: "active" | "completed" | "failed" | "canceled";
};

export type ConversationSourceInventory = {
  web: ConversationWebSource[];
  memory: ConversationMemorySource[];
  attachments: ConversationAttachmentSource[];
  browser: ConversationBrowserSource[];
};

const MEMORY_NAMES: Record<MemorySourceRef["kind"], string> = {
  chat_memory: "Saved memory",
  project_memory: "Project memory",
  conversation_summary: "Conversation summary",
};

const BROWSER_STATUSES: Record<Activity["status"], ConversationBrowserSource["status"]> = {
  running: "active",
  done: "completed",
  failed: "failed",
  canceled: "canceled",
};

function displayText(value: string, fallback: string) {
  return (
    value
      .replace(/\p{Cc}/gu, " ")
      .trim()
      .slice(0, 180) || fallback
  );
}

function includeMessage(row: { messageIds: string[] }, messageId: string) {
  if (!row.messageIds.includes(messageId)) row.messageIds.push(messageId);
}

/**
 * Read-only inventory of this conversation's recorded evidence. It never reads
 * global memory, guesses links from prose, treats generated files as inputs, or
 * infers browser use from web search, response text, or streaming state.
 *
 * The current Message contract records provided web/memory context and available
 * attachments, not per-source influence or attachment consumption. Keep those
 * distinctions instead of upgrading any of them to "used". Browser rows require
 * an explicit browser_interact activity; there is no chat browser event producer
 * today. Synthetic review fixtures must identify themselves in their own UI.
 */
export function conversationSources(
  conversation: Conversation,
  ownerId: string | null = null,
): ConversationSourceInventory {
  const web = new Map<string, ConversationWebSource>();
  const memory = new Map<string, ConversationMemorySource>();
  const attachments: ConversationAttachmentSource[] = [];
  const browser: ConversationBrowserSource[] = [];

  for (const message of conversation.messages) {
    if (message.role === "user") {
      message.attachments?.forEach((attachment, attachmentIndex) => {
        const outputId = `${message.id}:attachment:${attachmentIndex}`;
        attachments.push({
          id: outputId,
          kind: "attachment",
          name:
            attachment.kind === "image"
              ? `Image ${attachmentIndex + 1}`
              : displayText(attachment.name, "Attached file"),
          messageId: message.id,
          attachmentIndex,
          outputId,
          attachmentKind: attachment.kind,
          usage: "available",
        });
      });
      continue;
    }
    if (message.role !== "assistant") continue;

    for (const source of normalizeResponseSources(message.sources) ?? []) {
      // Preserve case-sensitive paths and query parameters. The normalizer
      // already canonicalizes the host, drops fragments, and removes credentials.
      const key = source.url;
      const existing = web.get(key);
      if (existing) includeMessage(existing, message.id);
      else
        web.set(key, {
          id: `web:${key}`,
          kind: "web",
          source,
          messageIds: [message.id],
          usage: "provided",
        });
    }

    const permitted = normalizeMemorySources(
      message.memorySources,
      ownerId,
      Boolean(conversation.temporary),
    );
    for (const source of permitted?.sources ?? []) {
      const key = `${source.kind}:${source.id}${source.kind === "project_memory" ? `:${source.projectId}` : ""}`;
      const existing = memory.get(key);
      if (existing) includeMessage(existing, message.id);
      else
        memory.set(key, {
          id: `memory:${key}`,
          kind: "memory",
          name: MEMORY_NAMES[source.kind],
          source,
          sources: { ownerId: permitted!.ownerId, sources: [source] },
          ownerId: permitted!.ownerId,
          messageIds: [message.id],
          usage: "provided",
        });
    }

    // Activities are per-tool snapshots in the chat stream. If a fixture or
    // restored message contains several snapshots, the latest valid one wins.
    let browserActivity: Activity | undefined;
    for (const activity of message.activities ?? []) {
      if (
        activity?.tool === "browser_interact" &&
        typeof activity.label === "string" &&
        Object.hasOwn(BROWSER_STATUSES, activity.status)
      )
        browserActivity = activity;
    }
    if (browserActivity)
      browser.push({
        id: `${message.id}:browser:browser_interact`,
        kind: "browser",
        messageId: message.id,
        tool: "browser_interact",
        label: displayText(browserActivity.label, "Browser activity"),
        status: BROWSER_STATUSES[browserActivity.status],
      });
  }

  return { web: [...web.values()], memory: [...memory.values()], attachments, browser };
}
