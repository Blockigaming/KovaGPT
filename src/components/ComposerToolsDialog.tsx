import { OpenAiTasksPanel } from "@/components/OpenAiTasksPanel";
import { AudioToolsPanel } from "@/components/AudioToolsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ComposerToolsDialog({
  ownerId,
  onClose,
  onReturnFocus,
}: {
  ownerId: string;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Tools</DialogTitle>
          <DialogDescription>
            Run an Agent task or work with audio. Switching tabs or closing tools cancels unfinished
            requests.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="tasks">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="tasks">Agent tasks</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
          </TabsList>
          <TabsContent value="tasks">
            <OpenAiTasksPanel ownerId={ownerId} />
          </TabsContent>
          <TabsContent value="audio">
            <AudioToolsPanel ownerId={ownerId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
