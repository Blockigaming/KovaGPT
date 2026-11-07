import "./public-foundation.css";
import "./spec400-public.css";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";

export function PublicHeader() {
  return (
    <header className="border-b border-border px-5 py-4">
      <nav
        aria-label="KovaGPT account navigation"
        className="mx-auto flex max-w-5xl items-center justify-between gap-4"
      >
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 font-semibold">
          <NovaLogo decorative className="h-6 w-6" />
          KovaGPT
        </Link>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to chat
        </Link>
      </nav>
    </header>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-public-shell
      className="flex min-h-[100dvh] min-w-0 flex-col bg-background text-foreground"
    >
      <PublicHeader />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
