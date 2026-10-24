import type { ComposerToolId, PendingAttachment } from "@/components/ChatInput";
import type { ModeId } from "@/lib/modes";

export type NextPromptScope = {
  principal: string;
  conversationId: string | null;
  temporary: boolean;
  temporaryContext: string;
  /** Monotonic mounted-workspace boundary, including A → B → A transitions. */
  lifetime?: number;
};
export type NextPrompt = {
  id: string;
  scope: NextPromptScope;
  waitingFor: string;
  text: string;
  attachments: PendingAttachment[];
  tool: ComposerToolId | null;
  mode: ModeId;
  status: "queued" | "ready" | "held";
  reason?: string;
};
export function sameNextPromptContext(a: NextPromptScope, b: NextPromptScope) {
  return (
    a.principal === b.principal &&
    a.conversationId === b.conversationId &&
    a.temporary === b.temporary &&
    a.temporaryContext === b.temporaryContext
  );
}
export function sameNextPromptScope(a: NextPromptScope, b: NextPromptScope) {
  return sameNextPromptContext(a, b) && (a.lifetime ?? 0) === (b.lifetime ?? 0);
}
export function advanceNextPromptScope(
  previous: NextPromptScope,
  next: NextPromptScope,
): NextPromptScope {
  return sameNextPromptContext(previous, next)
    ? previous
    : { ...next, lifetime: (previous.lifetime ?? 0) + 1 };
}
export function snapshotNextPrompt(input: Omit<NextPrompt, "status">): NextPrompt {
  return {
    ...input,
    scope: { ...input.scope },
    attachments: input.attachments.map((file) => ({
      ...file,
      ...(file.pasteOrigin ? { pasteOrigin: { ...file.pasteOrigin } } : {}),
    })),
    status: "queued",
  };
}
export function holdNextPrompt(next: NextPrompt | null, reason: string): NextPrompt | null {
  return next && next.status !== "held" ? { ...next, status: "held", reason } : next;
}
export function settleNextPrompt(
  next: NextPrompt | null,
  waitingFor: string,
  success: boolean,
): NextPrompt | null {
  if (!next || next.waitingFor !== waitingFor || next.status !== "queued") return next;
  return success
    ? { ...next, status: "ready" }
    : holdNextPrompt(
        next,
        "The response did not finish successfully. This message has not been sent.",
      );
}
export function matchesNextPromptDraft(
  next: NextPrompt,
  draft: { text: string; attachments: PendingAttachment[]; tool: ComposerToolId | null },
) {
  return (
    next.text === draft.text &&
    next.tool === draft.tool &&
    JSON.stringify(next.attachments) === JSON.stringify(draft.attachments)
  );
}
