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
      <DialogContent data-ui-reference="chatgpt.auth.sign-in-prompt">
        <DialogHeader className="text-center">
          <div className="flex justify-center mb-2">
            <NovaLogo className="w-8 h-8" />
          </div>
          <DialogTitle className="text-center">Sign in to continue</DialogTitle>
          <DialogDescription className="text-center">
            Sign in or create an account to continue working, access smarter agents, and save your
            work.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <SignInButton mode="modal">
            <Button
              size="prominent"
              data-ui-reference="chatgpt.auth.sign-in-prompt.action"
              className=" w-full "
            >
              Log in
            </Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button
              size="prominent"
              data-ui-reference="chatgpt.auth.sign-in-prompt.action"
              variant="outline"
              className=" w-full "
            >
              Sign up
            </Button>
          </SignUpButton>
          <Button
            data-ui-reference="chatgpt.auth.sign-in-prompt.action"
            variant="link"
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground hover:underline mt-1"
          >
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
