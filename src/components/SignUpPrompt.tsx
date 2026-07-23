import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
          <DialogTitle className="text-center">Sign in to continue</DialogTitle>
          <DialogDescription className="text-center">
            Sign in or create an account to continue working, access smarter agents, and save your
            work.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <SignInButton mode="modal">
            <Button className="w-full">Sign in</Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button variant="outline" className="w-full">
              Create account
            </Button>
          </SignUpButton>
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
