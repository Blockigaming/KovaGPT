import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SettingsDialog, SETTINGS_SECTIONS } from "@/components/SettingsDialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { useNovaSettings } from "@/lib/use-nova-settings";

export const Route = createFileRoute("/settings/$section")({ component: SettingsPage });
function SettingsPage() {
  const { section } = Route.useParams();
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const [settings, setSettings] = useNovaSettings(user?.id ?? null, isLoaded);
  const valid = Object.prototype.hasOwnProperty.call(SETTINGS_SECTIONS, section);
  const tab = valid
    ? SETTINGS_SECTIONS[section as keyof typeof SETTINGS_SECTIONS]
    : "personalization";
  return (
    <AppShell utilitiesInHeader hideUtilities>
      <main id="main-content" className="kova-page kova-secondary-page kova-settings-route">
        {!valid ? (
          <p role="status">
            This settings section is unavailable. Profile settings are shown below.
          </p>
        ) : null}
        <SettingsDialog
          open
          page
          initialTab={tab}
          settings={settings}
          onChange={setSettings}
          onClearAll={() => {
            /* Shared storage-clear events update the surrounding shell. */
          }}
          onOpenChange={(open) => {
            if (!open) void navigate({ to: "/" });
          }}
          onSectionChange={(next) =>
            void navigate({ to: "/settings/$section", params: { section: next } })
          }
        />
      </main>
    </AppShell>
  );
}
