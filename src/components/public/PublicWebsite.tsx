import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { NovaLogo } from "@/components/NovaLogo";

export function PublicWebsiteHome({
  mode = "sign-in",
  pending = false,
}: {
  mode?: "sign-in" | "sign-up";
  pending?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold">
          <NovaLogo decorative className="h-7 w-7" /> KovaGPT
        </Link>
      </header>
      <main id="main-content" tabIndex={-1} aria-busy={pending || undefined}
        className="flex flex-1 flex-col items-center justify-center gap-5 px-4 pb-16">
        <h1 className="text-2xl font-semibold">{mode === "sign-up" ? "Create your account" : "Sign in to KovaGPT"}</h1>
        <AuthDialog open={open} mode={mode} onOpenChange={setOpen} inline />
        <nav aria-label="Account information" className="flex flex-wrap justify-center gap-5 text-sm text-muted-foreground">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/help">Help</Link>
        </nav>
      </main>
    </div>
  );
}
