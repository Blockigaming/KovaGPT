import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import type { Conversation } from "@/lib/chat-store";
const HistoryStatus = lazy(() =>
  import("@/components/ChatHistorySync").then((module) => ({
    default: module.ChatHistorySyncStatus,
  })),
);
export function ChatWorkspaceControls({
  ownerId,
  active,
}: {
  ownerId: string | null;
  active: Conversation | null | undefined;
  temporary: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 py-2">
      <Suspense fallback={null}>
        {active?.kova && (
          <Link
            className="kova-button rounded border px-2 py-1 text-xs"
            to={"/kovas" as never}
            search={{ id: active.kova.id } as never}
          >
            Custom Kova · {active.mode} · view configuration
          </Link>
        )}
        {ownerId && <HistoryStatus key={`history:${ownerId}`} />}
      </Suspense>
    </div>
  );
}
