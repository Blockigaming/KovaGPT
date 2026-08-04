import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="sm:max-w-[420px] p-0 border-0 bg-transparent shadow-none [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative rounded-3xl border border-border/60 bg-card shadow-2xl p-8 animate-in fade-in-0 zoom-in-95 duration-300">

          <div className="flex flex-col items-center text-center">
            <div className="mb-4 w-14 h-14 rounded-2xl bg-foreground/[0.04] ring-1 ring-border flex items-center justify-center">
              <NovaLogo className="w-9 h-9" />
            </div>
            <h2 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 text-[14px] text-muted-foreground max-w-[320px]">{description}</p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <SignUpButton mode="modal">
              <button className="w-full h-12 rounded-2xl bg-foreground text-background font-medium hover:opacity-90 transition">
                Sign up for free
              </button>
            </SignUpButton>
            <SignInButton mode="modal">
              <button className="w-full h-12 rounded-2xl border border-border font-medium hover:bg-accent transition">
                Log in
              </button>
            </SignInButton>
            <button
              onClick={() => onOpenChange(false)}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground transition"
            >
              Not now
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-background border border-border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
