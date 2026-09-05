import { lazy, Suspense, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const StudyPanel = lazy(() =>
  import("@/components/StudyPanel").then((module) => ({ default: module.StudyPanel })),
);
export function ChatStudyControl({
  ownerId,
  temporary,
  source,
}: {
  ownerId: string | null;
  temporary: boolean;
  source: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="min-h-11 rounded-lg border px-3 py-2 text-sm"
        onClick={() => setOpen(true)}
      >
        Practice this explanation
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Study from this chat</DialogTitle>
            <DialogDescription>Review the explanation and set a learning goal.</DialogDescription>
          </DialogHeader>
          {open && (
            <Suspense fallback={<p role="status">Loading practice…</p>}>
              <StudyPanel ownerId={ownerId} temporary={temporary} source={source} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
