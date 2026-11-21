import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SETTINGS_SECTIONS } from "@/components/SettingsDialog";
import { useEffect } from "react";

export const Route = createFileRoute("/settings/$section")({ component: SettingsPage });

function SettingsPage() {
  const { section } = Route.useParams();
  const navigate = useNavigate();
  const valid = Object.prototype.hasOwnProperty.call(SETTINGS_SECTIONS, section);
  const tab = valid ? SETTINGS_SECTIONS[section as keyof typeof SETTINGS_SECTIONS] : "general";

  useEffect(() => {
    // Keep the continuation alive across this route's unmount: navigating to
    // chat replaces this component before AppShell can receive the open event.
    void navigate({ to: "/", replace: true }).then(() => {
      window.dispatchEvent(new CustomEvent("kova-open-settings", { detail: { tab } }));
    });
  }, [navigate, tab]);

  return null;
}
