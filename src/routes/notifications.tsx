import { createFileRoute } from "@tanstack/react-router";
import { Bell, CheckCheck, Mail, Settings, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";

export const Route = createFileRoute("/notifications")({ component: NotificationsRoute });

const preferenceRows = [
  { label: "Tasks", description: "Scheduled-task results and failures", enabled: true },
  {
    label: "Projects and sharing",
    description: "Invitations, role changes, and shared-chat updates",
    enabled: true,
  },
  {
    label: "Connectors",
    description: "Google reauthorization and permission issues",
    enabled: true,
  },
  {
    label: "Billing",
    description: "Payment issues and subscription status changes",
    enabled: true,
  },
  { label: "Security", description: "Sign-in and account-safety alerts", enabled: true },
];

function NotificationsRoute() {
  return (
    <AppShell>
      <main
        className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
        aria-labelledby="notifications-title"
      >
        <header className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Notification center</p>
            <h1
              id="notifications-title"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Notifications
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Review task results, project invitations, connector reauthorization, billing, and
              security alerts. Private Gmail and Drive content is never shown in previews.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Notification actions">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-accent"
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all read
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Settings className="h-4 w-4" aria-hidden="true" /> Preferences
            </button>
          </div>
        </header>

        <section
          aria-labelledby="notifications-empty"
          className="rounded-3xl border border-border bg-card p-6"
        >
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="Task results, project invites, and security alerts appear here."
            action={
              <button
                type="button"
                className="min-h-11 rounded-full border border-border px-4 text-sm font-medium hover:bg-accent"
              >
                Notification settings
              </button>
            }
          />
          <p id="notifications-empty" className="sr-only">
            There are currently no notifications.
          </p>
        </section>

        <section
          aria-labelledby="delivery-preferences"
          className="rounded-3xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <h2 id="delivery-preferences" className="text-lg font-semibold text-foreground">
                Delivery preferences
              </h2>
              <p className="text-sm text-muted-foreground">
                In-app and verified account-email delivery are supported. Browser push is hidden
                until a real push provider exists.
              </p>
            </div>
          </div>
          <div
            className="mt-4 divide-y divide-border rounded-2xl border border-border"
            role="list"
            aria-label="Notification preference categories"
          >
            {preferenceRows.map((row) => (
              <div
                key={row.label}
                role="listitem"
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-foreground">{row.label}</p>
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                </div>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    defaultChecked={row.enabled}
                    className="h-5 w-5 rounded border-border"
                    aria-label={`${row.label} notifications`}
                  />
                  In-app + email
                </label>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
              <Mail className="mb-2 h-4 w-4 text-primary" aria-hidden="true" /> Account email must
              be verified before email delivery is enabled.
            </div>
            <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="mb-2 h-4 w-4 text-primary" aria-hidden="true" /> Security
              alerts stay enabled for account protection.
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
