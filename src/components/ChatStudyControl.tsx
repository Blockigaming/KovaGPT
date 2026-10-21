import { lazy, Suspense } from "react";
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
  open,
  onOpenChange,
  onRestoreFocus,
}: {
  ownerId: string | null;
  temporary: boolean;
  source: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85dvh] max-w-3xl overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Study from this chat</DialogTitle>
          <DialogDescription>Practice this response and set a learning goal.</DialogDescription>
        </DialogHeader>
        {open && (
          <Suspense fallback={<p role="status">Loading practice…</p>}>
            <StudyPanel ownerId={ownerId} temporary={temporary} source={source} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
