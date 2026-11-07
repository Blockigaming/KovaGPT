import "./public-website.css";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { AuthDialog } from "@/components/auth/AuthDialog";

export function WebsiteBrand() {
  return <Link to="/" className="inline-flex items-center gap-2 font-semibold" aria-label="KovaGPT home">
    <NovaLogo decorative className="h-7 w-7" /><span>KovaGPT</span>
  </Link>;
}
export function PublicWebsiteLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
    <header className="p-5"><WebsiteBrand /></header>
    {children}
  </div>;
}
export function PublicWebsiteHome({
  mode = "sign-in",
  pending = false,
}: {
  mode?: "sign-in" | "sign-up";
  pending?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return <PublicWebsiteLayout>
    <main id="main-content" tabIndex={-1} aria-busy={pending || undefined}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 px-5 pb-16">
      <h1 className="text-center text-2xl font-semibold">
        {mode === "sign-up" ? "Create your KovaGPT account" : "Sign in to KovaGPT"}
      </h1>
      <AuthDialog open={open} mode={mode} onOpenChange={setOpen} inline />
      <p className="text-center text-xs text-muted-foreground">
        <Link to="/terms" className="underline">Terms</Link>
        {" · "}
        <Link to="/privacy" className="underline">Privacy</Link>
        {" · "}
        <Link to="/help" className="underline">Help</Link>
      </p>
    </main>
  </PublicWebsiteLayout>;
}
