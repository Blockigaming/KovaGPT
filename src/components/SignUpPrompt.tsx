import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SignInButton, SignUpButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { NovaLogo } from "@/components/NovaLogo";

export function SignUpPrompt({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <NovaLogo className="w-14 h-14" />
          </div>
          <DialogTitle className="text-center">Save your conversation</DialogTitle>
          <DialogDescription className="text-center">
            You've sent 5 messages. Create a free account or sign in to save this
            chat and pick up where you left off  -  on any device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <SignUpButton mode="modal">
            <Button className="w-full">Create a free account</Button>
          </SignUpButton>
          <SignInButton mode="modal">
            <Button variant="outline" className="w-full">Sign in</Button>
          </SignInButton>
          <button
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground hover:underline mt-1"
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
