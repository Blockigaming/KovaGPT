import { lazy, type RefObject, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { ResultDescriptor } from "@/components/ArtifactEditor";
import type { GenerativeWidget } from "@/lib/generative-ui.mjs";

export type WorkspaceResultDescriptor = ResultDescriptor & {
  widget?: GenerativeWidget;
  canvasSourceKey?: string;
};

const GenerativeCanvas = lazy(() =>
  import("@/components/generative-ui/GenerativeCanvas").then((module) => ({
    default: module.GenerativeCanvas,
  })),
);
const ArtifactEditor = lazy(() =>
  import("@/components/ArtifactEditor").then((module) => ({ default: module.ArtifactEditor })),
);

type WorkspaceResultContentProps = {
  result: WorkspaceResultDescriptor;
  wideResult: boolean;
  paneRatio: number;
  setLayoutRatio: (next: number) => void;
  setPaneRatio: (next: number) => void;
  closeResult: () => void;
  storagePrincipal: string;
  activeId: string | null;
  resultScopeRef: RefObject<string | null>;
  resultPrincipalRef: RefObject<string>;
  resultDraftsRef: RefObject<Map<string, WorkspaceResultDescriptor>>;
  openResult: (next: WorkspaceResultDescriptor, trigger?: HTMLElement) => void;
  setInput: (next: SetStateAction<string>) => void;
  setResultTab: (tab: "conversation" | "result") => void;
};

/** Result content is loaded only after opening an editor or Canvas. */
export function WorkspaceResultContent({
  result,
  wideResult,
  paneRatio,
  setLayoutRatio,
  setPaneRatio,
  closeResult,
  storagePrincipal,
  activeId,
  resultScopeRef,
  resultPrincipalRef,
  resultDraftsRef,
  openResult,
  setInput,
  setResultTab,
}: WorkspaceResultContentProps) {
  return (
    <>
      {wideResult && (
        <div className="spec400-layout-controls">
          <button
            type="button"
            className="spec400-icon-button"
            aria-label="Narrow conversation"
            title="Narrow conversation"
            onClick={() => setLayoutRatio(paneRatio - 0.05)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="spec400-icon-button"
            aria-label="Widen conversation"
            title="Widen conversation"
            onClick={() => setLayoutRatio(paneRatio + 0.05)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="spec400-toolbar-button"
            onClick={() => setPaneRatio(0.45)}
          >
            <RotateCcw aria-hidden="true" />
            Reset layout
          </button>
        </div>
      )}
      {result.widget ? (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">{result.title}</h2>
            <button
              type="button"
              className="min-h-11 rounded-full border border-border px-4 text-sm hover:bg-accent"
              onClick={closeResult}
            >
              Close Canvas
            </button>
          </div>
          <GenerativeCanvas
            expanded
            widget={result.widget}
            key={`${storagePrincipal}:${activeId}:${result.canvasSourceKey ?? result.title}`}
            onDraftChange={(widget) => {
              const scope = resultScopeRef.current;
              if (scope && resultPrincipalRef.current === storagePrincipal)
                resultDraftsRef.current.set(scope, {
                  ...result,
                  widget,
                  initialContent: JSON.stringify(widget, null, 2),
                });
            }}
            onOpenEditor={(content, kind, title) =>
              openResult({
                title,
                initialContent: content,
                canvasSourceKey: `${result.canvasSourceKey}:editor`,
                kind,
                initialMode: "edit",
                chatId: null,
                messageId: null,
                projectId: null,
              })
            }
          />
        </div>
      ) : (
        <ArtifactEditor
          key={`${result.chatId ?? "session"}:${result.messageId ?? result.canvasSourceKey ?? result.title}`}
          {...result}
          open
          embedded
          onResetLayout={!wideResult ? () => setPaneRatio(0.45) : undefined}
          onDraftChange={(content) => {
            const scope = resultScopeRef.current;
            if (scope && resultPrincipalRef.current === storagePrincipal)
              resultDraftsRef.current.set(scope, { ...result, initialContent: content });
          }}
          onClose={closeResult}
          onImprove={(prompt) => {
            setInput((draft) => (draft.trim() ? `${draft}\n\n${prompt}` : prompt));
            setResultTab("conversation");
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
                ?.focus(),
            );
          }}
        />
      )}
    </>
  );
}

/** Keep the wide result's resize controls with its deferred editor content. */
export function WorkspaceResultDivider({
  workspaceRef,
  paneRatio,
  setLayoutRatio,
  setPaneRatio,
}: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  paneRatio: number;
  setLayoutRatio: (next: number) => void;
  setPaneRatio: (next: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-label="Resize conversation and result"
      aria-orientation="vertical"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(paneRatio * 100)}
      tabIndex={0}
      className="spec400-pane-divider"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = workspaceRef.current?.getBoundingClientRect();
        if (bounds) setLayoutRatio((event.clientX - bounds.left) / bounds.width);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setLayoutRatio(paneRatio + (event.key === "ArrowLeft" ? -0.02 : 0.02));
        } else if (event.key === "Home") {
          event.preventDefault();
          setPaneRatio(0.45);
        }
      }}
    />
  );
}
