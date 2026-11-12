import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const requester = "10000000-0000-4000-8000-000000000002";
const team = "20000000-0000-4000-8000-000000000001";
const otherTeam = "20000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000001";
const otherRequest = "30000000-0000-4000-8000-000000000002";

function fixture(status = "pending") {
  const rows = {
    team_workspaces: [
      { id: team, owner_id: owner },
      { id: otherTeam, owner_id: owner },
    ],
    team_join_requests: [
      { id: requestId, team_id: team, requester_id: requester, status },
      { id: otherRequest, team_id: otherTeam, requester_id: requester, status: "pending" },
    ],
  };
  const rpcCalls = [];
  const reads = [];
  const deliveries = [];
  const modules = {
    "@tanstack/react-start": {
      createMiddleware: () => ({ server: (fn) => fn }),
      createServerFn() {
        let validate;
        const builder = {
          middleware: () => builder,
          validator(fn) {
            validate = fn;
            return builder;
          },
          handler: (fn) => (userId, data) => fn({ context: { userId }, data: validate(data) }),
        };
        return builder;
      },
    },
    "@tanstack/react-start/server": { getRequest() {} },
    zod: { z },
    "./api-auth.server": {},
    "./distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "./supabase-loose": { loose: (client) => client },
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        from(table) {
          reads.push(table);
          let matched = rows[table];
          const query = {
            select: () => query,
            eq(key, value) {
              matched = matched.filter((row) => row[key] === value);
              return query;
            },
            maybeSingle: async () => ({ data: matched[0] ?? null }),
            order: () => query,
            limit: async () => ({ data: matched }),
          };
          return query;
        },
      },
    },
    "./team-billing.server": {
      async teamRpc(name, args) {
        rpcCalls.push({ name, args });
        return {
          discover_verified_team_workspaces: [],
          request_verified_team_join: requestId,
          review_verified_team_join: true,
        }[name];
      },
    },
    "./workspace-join-notifications.server": {
      async deliverJoinRequestNotice(id) {
        deliveries.push(id);
        throw new Error("Delivery temporarily unavailable");
      },
    },
  };
  return {
    handlers: loadUiModule("src/lib/workspace-join.functions.ts", modules),
    rpcCalls,
    reads,
    deliveries,
  };
}

test("all workspace request endpoints reject an account switch before accessing workspace data", async () => {
  const { handlers, rpcCalls, reads } = fixture();
  const stale = { expectedUserId: requester };
  for (const operation of [
    () => handlers.findAvailableWorkspaces(owner, stale),
    () => handlers.submitWorkspaceJoinRequest(owner, { ...stale, teamId: team }),
    () => handlers.listTeamJoinRequests(owner, { ...stale, teamId: team }),
    () =>
      handlers.reviewTeamJoinRequest(owner, {
        ...stale,
        teamId: team,
        requestId,
        approve: true,
      }),
  ])
    await assert.rejects(operation(), /Your account changed/);
  assert.deepEqual(rpcCalls, []);
  assert.deepEqual(reads, []);
});

test("submission reports the persisted request state even when email delivery is unavailable", async () => {
  for (const status of ["pending", "approved", "denied"]) {
    const { handlers, deliveries } = fixture(status);
    const result = await handlers.submitWorkspaceJoinRequest(requester, {
      expectedUserId: requester,
      teamId: team,
    });
    assert.deepEqual({ ...result }, { id: requestId, status });
    assert.deepEqual(deliveries, [requestId]);
  }
});

test("owners list only the selected workspace and cannot review a request through a different workspace", async () => {
  const { handlers, rpcCalls, reads } = fixture();
  const selection = { expectedUserId: owner, teamId: team };
  const own = await handlers.listTeamJoinRequests(owner, selection);
  assert.deepEqual(
    own.map((row) => row.id),
    [requestId],
  );

  const callsBefore = reads.length;
  const unavailable = await handlers.listTeamJoinRequests(requester, {
    ...selection,
    expectedUserId: requester,
  });
  assert.equal(unavailable.length, 0);
  assert.deepEqual(reads.slice(callsBefore), ["team_workspaces"]);

  await assert.rejects(
    handlers.reviewTeamJoinRequest(owner, { ...selection, requestId: otherRequest, approve: true }),
    /request is unavailable/,
  );
  assert.deepEqual(rpcCalls, []);
  const saved = await handlers.reviewTeamJoinRequest(owner, {
    ...selection,
    requestId,
    approve: true,
  });
  assert.deepEqual({ ...saved }, { ok: true, membershipCreated: false });
  assert.deepEqual(
    rpcCalls.map(({ name, args }) => ({ name, args: { ...args } })),
    [
      {
        name: "review_verified_team_join",
        args: { p_actor: owner, p_id: requestId, p_approve: true },
      },
    ],
  );
});
