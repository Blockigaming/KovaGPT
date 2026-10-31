import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { deferred } from "../helpers/ui-state-harness.mjs";

function fixture(list) {
  let owner = "owner-a";
  const f = reactFixture("src/routes/notifications.tsx", (module) => module.NotificationsRoute, {
    sourceSuffix: "\nexport { NotificationsRoute };",
    modules: {
      "@/components/ui/select": Object.fromEntries(
        ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
          name,
          name,
        ]),
      ),
      "@tanstack/react-router": { createFileRoute: () => (config) => config, Link: "Link" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: Boolean(owner), user: { id: owner } }),
      },
      "@/hooks/use-time-format-preference": { useTimeFormatPreference: () => "24-hour" },
      "@/lib/time-format": { formatDisplayDateTime: (value) => value },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/components/WorkspacePageHeader": { WorkspacePageHeader: "WorkspacePageHeader" },
      "@/components/states": { EmptyState: "EmptyState", ErrorState: "ErrorState" },
      "@/lib/notification-center.functions": {
        listNotifications: () => list(owner),
        markNotificationsRead: async () => {},
        deleteNotifications: async () => {},
      },
      "lucide-react": Object.fromEntries(
        ["Bell", "Check", "CheckCheck", "Loader2", "Search", "Trash2"].map((name) => [name, name]),
      ),
    },
  });
  return {
    ...f,
    owner: (next) => {
      owner = next;
    },
  };
}

test("a notification service error payload leaves the page usable and Retry can recover", async () => {
  for (const invalid of [null, {}, { error: "Unavailable" }]) {
    let result = invalid;
    const f = fixture(async () => result);
    await f.flush();
    assert.equal(f.find("WorkspacePageHeader").props.title, "Notifications");
    const error = f.find("ErrorState");
    assert.equal(error.props.title, "Notifications unavailable");
    assert.equal(error.props.description, "Notifications could not be loaded.");
    result = [];
    await error.props.onRetry();
    await f.flush();
    assert.equal(f.find("EmptyState").props.title, "No notifications");
    f.unmount();
  }
});

test("a delayed notification result cannot replace the next account's page", async () => {
  const old = deferred();
  const f = fixture((owner) => (owner === "owner-a" ? old.promise : Promise.resolve([])));
  await f.flush();
  f.owner("owner-b");
  await f.flush();
  old.resolve({ error: "Obsolete owner response" });
  await f.flush();
  assert.equal(f.find("EmptyState").props.title, "No notifications");
  assert.equal(
    f.nodes().some((node) => node.type === "ErrorState"),
    false,
  );
  f.unmount();
});
