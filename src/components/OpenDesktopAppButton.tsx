import { useSyncExternalStore } from "react";
import { Monitor } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  canPromptInstall,
  noServerPrompt,
  promptPwaInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install";

const subscribeDisplayMode = (listener: () => void) => {
  const mode = window.matchMedia("(display-mode: standalone)");
  mode.addEventListener("change", listener);
  return () => mode.removeEventListener("change", listener);
};
const inDesktopApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  /KovaGPTDesktop\//.test(navigator.userAgent);

export function OpenDesktopAppButton() {
  const navigate = useNavigate();
  const standalone = useSyncExternalStore(subscribeDisplayMode, inDesktopApp, noServerPrompt);
  const available = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, noServerPrompt);
  if (standalone) return null;
  return (
    <button
      type="button"
      className="kova-composer-tray-action kova-open-desktop-app"
      onClick={() => {
        if (available) {
          void promptPwaInstall().catch(() => {
            toast.error("The browser could not start installation.");
            void navigate({ to: "/download" });
          });
        } else {
          void navigate({ to: "/download" });
        }
      }}
    >
      <Monitor aria-hidden="true" />
      <span>Open desktop app</span>
    </button>
  );
}
