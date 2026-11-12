import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import {
  persistedNoticeKind,
  readSessionSeen,
  rememberSessionSeen,
  pendingPersistedNotices,
  safePersistedNoticeActionUrl,
} from "../../src/lib/persisted-notification-policy.mjs";
const id = "550e8400-e29b-41d4-a716-446655440000";
const task = (type) => ({
  id,
  type,
  title: "Task complete",
  preview: "Done",
  readAt: null,
  actionUrl: "/scheduled-tasks",
  source: "application",
});
test("real persisted task results and errors map to catalog IDs", () => {
  assert.equal(persistedNoticeKind(task("task_result")), "task_completed");
  assert.equal(persistedNoticeKind(task("task_failure")), "task_failed");
  assert.equal(persistedNoticeKind(task("not_a_real_type")), null);
  assert.equal(
    persistedNoticeKind({ ...task("task_result"), readAt: "2026-11-10T12:00:00Z" }),
    null,
  );
});
test("only eligible unread notifications are surfaced and old inbox records remain", () => {
  const rows = [
    task("task_result"),
    { ...task("task_failure"), id: "650e8400-e29b-41d4-a716-446655440001" },
    { ...task("task_result"), id: "750e8400-e29b-41d4-a716-446655440002" },
  ];
  assert.equal(pendingPersistedNotices(rows, new Set(), 2).length, 2);
  assert.equal(pendingPersistedNotices(rows, new Set([id]), 2).length, 2);
  assert.equal(pendingPersistedNotices(rows, new Set(rows.map((r) => r.id)), 2).length, 0);
});
test("untrusted notification action links never leave app origin", () => {
  assert.equal(safePersistedNoticeActionUrl("/scheduled-tasks"), "/scheduled-tasks");
  assert.equal(
    safePersistedNoticeActionUrl("/projects/abc?tab=activity"),
    "/projects/abc?tab=activity",
  );
  for (const candidate of [
    "https://evil.test",
    "//evil.test",
    "javascript:alert(1)",
    "/\\evil.test",
    "/x\nHeader:bad",
  ]) {
    assert.equal(safePersistedNoticeActionUrl(candidate), null, candidate);
  }
});
test("root has one global host and an authenticated persisted-notice bridge", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  assert.equal([...root.matchAll(/<KovaNotificationSurface\b/g)].length, 1);
  assert.match(root, /<KovaNotificationSurface key=\{user\?\.id \?\? "guest"\}/);
  assert.match(
    root,
    /isSignedIn && user\?\.id \? \([\s\S]*?<Suspense key=\{user\.id\}[^>]*>\s*<PersistedNoticeBridge ownerId=\{user\.id\}/,
  );
  const bridge = readFileSync("src/components/PersistedNoticeBridge.tsx", "utf8");
  assert.match(bridge, /listNotifications/);
  assert.match(bridge, /markNotificationsRead/);
  assert.match(bridge, /document\.visibilityState === "visible"/);
});

test("server-emitted project, connection, research and security events retain their semantics", () => {
  const types = {
    project_invitation: "invitation_received",
    project_member_joined: "member_joined",
    project_role_change: "permission_changed",
    connector_reauth: "connection_expired",
    deep_research_complete: "research_completed",
    security_alert: "security_check",
  };
  for (const [type, id] of Object.entries(types)) {
    assert.equal(persistedNoticeKind(task(type)), id, type);
  }
  for (const type of ["billing_issue", "usage_threshold"]) {
    assert.equal(
      persistedNoticeKind(task(type)),
      null,
      "no fabricated billing/usage status for " + type,
    );
  }
});

test("durable notification playback deduplicates across reloads without changing server read state", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const owner = "550e8400-e29b-41d4-a716-446655440000";
  const id = "650e8400-e29b-41d4-a716-446655440001";
  assert.equal(readSessionSeen(storage, owner).size, 0);
  assert.equal(rememberSessionSeen(storage, owner, new Set([id])), true);
  assert.equal(readSessionSeen(storage, owner).has(id), true);
  assert.equal(readSessionSeen(storage, "750e8400-e29b-41d4-a716-446655440002").has(id), false);
  assert.equal(
    readSessionSeen(
      {
        getItem() {
          throw Error("blocked");
        },
      },
      owner,
    ).size,
    0,
  );
});

test("the inbox reads and mutates only delivered notifications for the requested account", async () => {
  const owner = "650e8400-e29b-41d4-a716-446655440001";
  const other = "750e8400-e29b-41d4-a716-446655440002";
  const requests = [];
  const client = createClient("https://inbox.test", "fixture-only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(input);
        const table = url.pathname.split("/").at(-1);
        assert.equal(url.searchParams.get("owner_id"), `eq.${owner}`);
        requests.push({ table, method: init.method });
        if (table === "agent_notifications") {
          return Response.json({ code: "PGRST205" }, { status: 404 });
        }
        assert.equal(table, "app_notifications");
        assert.equal(url.searchParams.get("delivery_state"), "eq.delivered");
        if (init.method === "GET") {
          assert.match(url.searchParams.get("or"), /expires_at\.is\.null,expires_at\.gt\./);
          return Response.json([
            {
              id,
              type: "task_result",
              title: "Task completed",
              safe_preview: "Saved",
              action_url: "//other.test",
              read_at: null,
              created_at: "2026-11-12T00:00:00Z",
            },
          ]);
        }
        assert.equal(url.searchParams.get("id"), `in.(${id})`);
        if (init.method === "PATCH") assert.equal(url.searchParams.get("read_at"), "is.null");
        return new Response(null, { status: 204 });
      },
    },
  });
  const inbox = loadUiModule("src/lib/notification-center.functions.ts", {
    "@tanstack/react-start": {
      createServerFn() {
        let validate;
        const builder = {
          middleware: () => builder,
          validator(fn) {
            validate = fn;
            return builder;
          },
          handler: (fn) => async (data) =>
            fn({ context: { userId: owner, supabase: client }, data: validate(data) }),
        };
        return builder;
      },
    },
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/persisted-notification-policy.mjs": { safePersistedNoticeActionUrl },
  });

  await assert.rejects(inbox.listNotifications({ expectedOwnerId: other }), /account changed/);
  await assert.rejects(
    inbox.markNotificationsRead({ expectedOwnerId: other, ids: [id], source: "application" }),
    /account changed/,
  );
  await assert.rejects(inbox.markNotificationsRead({ expectedOwnerId: owner, ids: [] }));
  assert.equal(requests.length, 0);
  const items = await inbox.listNotifications({ expectedOwnerId: owner });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, id);
  assert.equal(items[0].actionUrl, null);
  const mutation = { expectedOwnerId: owner, ids: [id], source: "application" };
  await inbox.markNotificationsRead(mutation);
  await inbox.deleteNotifications(mutation);
  assert.deepEqual(
    requests.filter(({ table }) => table === "app_notifications").map(({ method }) => method),
    ["GET", "PATCH", "DELETE"],
  );
});
