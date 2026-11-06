import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import type { Conversation } from "@/lib/chat-store";
const HistoryStatus = lazy(() =>
  import("@/components/ChatHistorySync").then((module) => ({
    default: module.ChatHistorySyncStatus,
  })),
);
const ChatWorkControl = lazy(() =>
  import("@/components/ChatWorkControl").then((module) => ({ default: module.ChatWorkControl })),
);
export function ChatWorkspaceControls({
  ownerId,
  active,
  temporary,
  objective = "",
}: {
  ownerId: string | null;
  active: Conversation | null | undefined;
  temporary: boolean;
  objective?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4">
      <Suspense fallback={null}>
        {active?.kova && (
          <Link
            className="kova-button my-2 rounded border px-2 py-1 text-xs"
            to={"/kovas" as never}
            search={{ id: active.kova.id } as never}
          >
            Custom Kova · {active.mode} · view configuration
          </Link>
        )}
        {ownerId && <HistoryStatus key={`history:${ownerId}`} />}
        {ownerId && !temporary && (
          <ChatWorkControl key={`work:${ownerId}`} ownerId={ownerId} objective={objective} />
        )}
      </Suspense>
    </div>
  );
}
