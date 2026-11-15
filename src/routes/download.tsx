import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  canPromptInstall,
  noServerPrompt,
  promptPwaInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install";
export const Route = createFileRoute("/download")({ component: DownloadPage });
function DownloadPage() {
  const available = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, noServerPrompt);
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:py-24"
      >
        <h1 className="text-4xl font-semibold tracking-tight">KovaGPT on your devices</h1>
        <p className="mt-5 text-muted-foreground">
          Install the KovaGPT web app for a dedicated window and a shortcut on your home screen.
        </p>
        {available && (
          <Button
            className="mt-6"
            onClick={() =>
              void promptPwaInstall().catch(() =>
                toast.error("Use your browser’s install command to install KovaGPT."),
              )
            }
          >
            Install KovaGPT
          </Button>
        )}
        <Button asChild variant="outline" className="ml-2 mt-6">
          <a href="kovagpt://open">Open installed native app</a>
        </Button>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-semibold">Mac and Windows</h2>
            <p className="mt-3 text-muted-foreground">
              Open KovaGPT in Chrome or Edge, then choose the install icon in the address bar. In
              Safari on Mac, choose File, then Add to Dock.
            </p>
          </section>
          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-semibold">iPhone</h2>
            <p className="mt-3 text-muted-foreground">
              Open KovaGPT in Safari on iPhone. Tap Share, then Add to Home Screen.
            </p>
          </section>
          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-semibold">iPad</h2>
            <p className="mt-3 text-muted-foreground">
              Open KovaGPT in Safari on iPad. Tap Share, then Add to Home Screen.
            </p>
          </section>
          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-semibold">Android</h2>
            <p className="mt-3 text-muted-foreground">
              Open KovaGPT in Chrome. Open the browser menu, then choose Install app or Add to Home
              screen.
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
