import { useEffect, useState, useSyncExternalStore } from "react";
import { Monitor } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  canPromptInstall,
  noServerPrompt,
  promptPwaInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install";

export function OpenDesktopAppButton() {
  const [native, setNative] = useState(false);
  const [error, setError] = useState("");
  const available = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, noServerPrompt);
  useEffect(() => {
    setNative(/KovaGPTDesktop\//.test(navigator.userAgent));
  }, []);
  if (native) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="kova-composer-tray-action kova-open-desktop-app">
          <Monitor aria-hidden="true" />
          <span>Open desktop app</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>KovaGPT on your desktop</DialogTitle>
          <DialogDescription>
            Use KovaGPT in its own window with the same interface and account.
          </DialogDescription>
        </DialogHeader>
        <Button asChild>
          <a href="kovagpt://open">Open installed desktop app</a>
        </Button>
        <p className="text-sm text-muted-foreground">
          If you haven't installed it, you can install the web app now. Native installers will
          appear on the download page when released.
        </p>
        {available ? (
          <Button
            variant="secondary"
            onClick={async () => {
              setError("");
              try {
                await promptPwaInstall();
              } catch {
                setError(
                  "Installation could not start. Use your browser’s Install app command, or see installation options.",
                );
              }
            }}
          >
            Install web app
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm">
            {error}
          </p>
        ) : null}
        <Link to="/download" className="text-sm underline">
          See installation options
        </Link>
      </DialogContent>
    </Dialog>
  );
}
