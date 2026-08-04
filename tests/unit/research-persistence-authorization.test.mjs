import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeResearchPersistence,
  ResearchPersistenceAuthorizationError,
} from "../../src/lib/research-persistence-authorization.server.mjs";

const OWN_CHAT = "11111111-1111-4111-8111-111111111111";
const OTHER_CHAT = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const PROJECT_CHAT = "55555555-5555-4555-8555-555555555555";
const CALLER = "66666666-6666-4666-8666-666666666666";
const OTHER_USER = "77777777-7777-4777-8777-777777777777";

function userClient({
  userId = CALLER,
  projects = [],
  memories = [],
  projectChats = [],
  failTables = [],
} = {}) {
  const rows = {
    projects,
    chat_memories: memories,
    project_chats: projectChats,
  };
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: "from", table });
      const filters = [];
      const query = {
        select(columns) {
          calls.push({ operation: "select", table, columns });
          return query;
        },
        eq(column, value) {
          calls.push({ operation: "eq", table, column, value });
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          calls.push({ operation: "maybeSingle", table });
          if (failTables.includes(table)) return { data: null, error: { code: "db_down" } };
          // Model the relevant RLS policies: memories are owner-only, while
          // projects and project chats are visible only to project members.
          const visible = (rows[table] ?? []).filter((row) => {
            if (table === "chat_memories") return row.user_id === userId;
            if (table === "projects") return row.member_ids?.includes(userId);
            if (table === "project_chats") {
              return projects.some(
                (project) => project.id === row.project_id && project.member_ids?.includes(userId),
              );
            }
            return false;
          });
          const data = visible.find((row) =>
            filters.every(([column, value]) => row[column] === value),
          );
          return { data: data ?? null, error: null };
        },
      };
      return query;
    },
  };
}

async function expectAuthorizationError(promise, { code, status }) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ResearchPersistenceAuthorizationError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("allows persistence without optional relationships without touching the database", async () => {
  const client = userClient();
  assert.deepEqual(await authorizeResearchPersistence({ supabaseUser: client }), {});
  assert.deepEqual(client.calls, []);
});

test("accepts only a main chat visible through the caller's RLS-scoped client", async () => {
  const client = userClient({
    memories: [
      { chat_id: OWN_CHAT, user_id: CALLER },
      { chat_id: OTHER_CHAT, user_id: OTHER_USER },
    ],
  });
  assert.deepEqual(await authorizeResearchPersistence({ supabaseUser: client, chatId: OWN_CHAT }), {
    chatId: OWN_CHAT,
  });

  await expectAuthorizationError(
    authorizeResearchPersistence({ supabaseUser: client, chatId: OTHER_CHAT }),
    { code: "research_chat_forbidden", status: 403 },
  );
});

test("rejects an unknown or cross-user project before checking a chat", async () => {
  const client = userClient({
    projects: [
      { id: PROJECT, member_ids: [CALLER] },
      { id: OTHER_PROJECT, member_ids: [OTHER_USER] },
    ],
    projectChats: [{ id: PROJECT_CHAT, project_id: PROJECT }],
  });
  await expectAuthorizationError(
    authorizeResearchPersistence({
      supabaseUser: client,
      chatId: PROJECT_CHAT,
      projectId: OTHER_PROJECT,
    }),
    { code: "research_project_forbidden", status: 403 },
  );
  assert.equal(
    client.calls.some((call) => call.table === "project_chats"),
    false,
  );
});

test("accepts a project chat only when both visible relationships match", async () => {
  const client = userClient({
    projects: [{ id: PROJECT, member_ids: [CALLER] }],
    projectChats: [{ id: PROJECT_CHAT, project_id: PROJECT }],
  });
  assert.deepEqual(
    await authorizeResearchPersistence({
      supabaseUser: client,
      chatId: PROJECT_CHAT,
      projectId: PROJECT,
    }),
    { chatId: PROJECT_CHAT, projectId: PROJECT },
  );

  await expectAuthorizationError(
    authorizeResearchPersistence({
      supabaseUser: client,
      chatId: OTHER_CHAT,
      projectId: PROJECT,
    }),
    { code: "research_chat_forbidden", status: 403 },
  );
});

test("fails closed on authorization storage errors before downstream work", async () => {
  const client = userClient({ failTables: ["projects"] });
  let providerCalls = 0;

  await expectAuthorizationError(
    authorizeResearchPersistence({ supabaseUser: client, projectId: PROJECT }).then(() => {
      providerCalls += 1;
    }),
    { code: "research_authorization_unavailable", status: 503 },
  );
  assert.equal(providerCalls, 0);
});

test("treats thrown database failures as an unavailable fail-closed result", async () => {
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          throw new Error("connection failed");
        },
      };
    },
  };
  await expectAuthorizationError(
    authorizeResearchPersistence({ supabaseUser: client, chatId: OWN_CHAT }),
    { code: "research_authorization_unavailable", status: 503 },
  );
});
