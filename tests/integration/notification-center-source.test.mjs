import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile("src/lib/notification-center.functions.ts", "utf8");
const route = await readFile("src/routes/notifications.tsx", "utf8");

test("notification center is owner-scoped and supports both durable stores", () => {
  assert.match(server, /\.eq\("owner_id", context\.userId\)/);
  assert.match(server, /app_notifications/);
  assert.match(server, /agent_notifications/);
  assert.match(server, /markNotificationsRead/);
  assert.match(server, /deleteNotifications/);
});

test("notification UI loads server truth and exposes search, filters, read, and delete", () => {
  for (const contract of [
    "useServerFn(listNotifications)",
    "Search notifications",
    "Filter notifications",
    "Mark all read",
    "Delete",
    "Connectors",
    "Scheduled tasks",
  ])
    assert.ok(route.includes(contract), contract);
});
