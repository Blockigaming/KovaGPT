import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SignInButton, SignUpButton } from "@/components/auth/ClerkSafe";
import { Sparkles } from "lucide-react";

export function LoginPromptDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <DialogTitle className="text-center text-xl">
            Log in or Sign up for Free to Start Generating for Free
          </DialogTitle>
          <DialogDescription className="text-center">
            Create stunning AI images in seconds with KovaGPT.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <SignUpButton mode="modal">
            <button className="w-full h-11 rounded-full bg-foreground text-background font-medium hover:opacity-90 transition">
              Sign up for free
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button className="w-full h-11 rounded-full border border-border font-medium hover:bg-accent transition">
              Log in
            </button>
          </SignInButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
