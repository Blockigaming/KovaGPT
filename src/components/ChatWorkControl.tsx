import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
import { lazy, Suspense, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
const WorkExecutionPanel = lazy(() =>
  import("@/components/WorkExecutionPanel").then((module) => ({
    default: module.WorkExecutionPanel,
  })),
);

/** Explicit review carries the selected chat request into the shared Work controls. */
export function ChatWorkControl({ ownerId, objective }: { ownerId: string; objective: string }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const view = createWorkViewLifetime(ownerId, () => {
      setOpen(false);
      setSeed("");
      setGeneration((value) => value + 1);
    });
    return view.dispose;
  }, [ownerId, generation]);
  return (
    <>
      <button
        type="button"
        className="rounded-lg border px-3 py-1.5 text-sm"
        onClick={() => {
          setSeed(objective.length <= 12000 ? objective : "");
          setOpen(true);
        }}
      >
        Prepare or manage Work
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Work from this chat</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Review the request and choose a Project before starting. Work status and controls stay
            available here and in Work.
          </p>
          <Suspense fallback={<p role="status">Loading Work controls…</p>}>
            <WorkExecutionPanel
              key={`${ownerId}:${generation}`}
              ownerId={ownerId}
              initialObjective={seed}
              source="chat"
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  );
}
