import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignInButton, SignUpButton } from "@/components/auth/ClerkSafe";
import { NovaLogo } from "@/components/NovaLogo";

export function LoginPromptDialog({
  open,
  onOpenChange,
  title = "Log in to continue",
  description = "Sign in or create a free KovaGPT account to generate images, upload files, and save your work.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ui-reference="chatgpt.auth.prompt">
        <DialogHeader className="items-center text-center">
          <NovaLogo className="mb-2 h-8 w-8" />
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="max-w-sm">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <SignUpButton mode="modal">
            <Button
              data-ui-reference="chatgpt.auth.prompt.action"
              size="prominent"
              className="w-full"
            >
              Sign up for free
            </Button>
          </SignUpButton>
          <SignInButton mode="modal">
            <Button
              data-ui-reference="chatgpt.auth.prompt.action"
              variant="outline"
              size="prominent"
              className="w-full"
            >
              Log in
            </Button>
          </SignInButton>
          <Button
            data-ui-reference="chatgpt.auth.prompt.action"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full text-muted-foreground"
          >
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
