import { lazy, Suspense } from "react";
import type { Conversation } from "@/lib/chat-store";
const HistoryStatus = lazy(() =>
  import("@/components/ChatHistorySync").then((module) => ({
    default: module.ChatHistorySyncStatus,
  })),
);
const WorkControl = lazy(() =>
  import("@/components/ChatWorkControl").then((module) => ({ default: module.ChatWorkControl })),
);
const StudyControl = lazy(() =>
  import("@/components/ChatStudyControl").then((module) => ({ default: module.ChatStudyControl })),
);
export function ChatWorkspaceControls({
  ownerId,
  active,
  temporary,
}: {
  ownerId: string | null;
  active: Conversation | null | undefined;
  temporary: boolean;
}) {
  const messages = active?.messages.slice().reverse() ?? [];
  const answer = messages.find((message) => message.role === "assistant")?.content ?? "";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 py-2">
      <Suspense fallback={null}>
        {ownerId && <HistoryStatus key={`history:${ownerId}`} />}
        {ownerId && (
          <WorkControl
            key={ownerId}
            ownerId={ownerId}
            objective={messages.find((message) => message.role === "user")?.content ?? ""}
          />
        )}{" "}
        {answer && (
          <StudyControl
            key={`${ownerId}:${active?.id}:${temporary}`}
            ownerId={ownerId}
            temporary={temporary}
            source={answer}
          />
        )}
      </Suspense>
    </div>
  );
}
