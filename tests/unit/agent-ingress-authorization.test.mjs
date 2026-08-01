import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_RUN_CONTROL_BODY_LIMIT_BYTES,
  AGENT_TEAM_CREATE_BODY_LIMIT_BYTES,
  AGENT_TEAM_MAX_TASKS,
  AgentRequestError,
  authorizeAgentProject,
  parseAgentRunControlPayload,
  parseAgentRunQuery,
  parseAgentTeamControlPayload,
  parseAgentTeamCreatePayload,
  readAgentJsonRequest,
} from "../../src/agents/agent-ingress.server.mjs";

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APPROVAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TASK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function validTeam(overrides = {}) {
  return {
    objective: "Research the launch",
    projectId: PROJECT,
    idempotencyKey: "agent-team-1",
    tasks: [
      {
        key: "plan",
        role: "planner",
        title: "Plan",
        instructions: "Create a bounded plan",
        dependencies: [],
      },
      {
        key: "review",
        role: "review",
        title: "Review",
        instructions: "Review the evidence",
        dependencies: ["plan"],
        checkpoint: true,
      },
    ],
    context: ["Approved context"],
    ...overrides,
  };
}

function expectAgentError(callback, { code, status = 400 }) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof AgentRequestError);
    assert.equal(error.code, code);
    assert.equal(error.publicMessage, code);
    assert.equal(error.status, status);
    return true;
  });
}

async function expectAgentErrorAsync(promise, { code, status = 400 }) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AgentRequestError);
    assert.equal(error.code, code);
    assert.equal(error.publicMessage, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("normalizes a valid bounded team request", () => {
  const parsed = parseAgentTeamCreatePayload(
    validTeam({
      objective: "  Research the launch\nwith citations  ",
      projectId: PROJECT.toUpperCase(),
      idempotencyKey: "  agent-team-1  ",
      tasks: [
        {
          key: "  plan  ",
          role: "planner",
          title: "  Plan  ",
          instructions: "  Create a bounded plan\nwith evidence  ",
          dependencies: [],
          checkpoint: false,
          reusableSubplan: "  Reuse verified sources  ",
        },
      ],
      context: ["  Approved context  "],
    }),
  );

  assert.deepEqual(parsed, {
    objective: "Research the launch\nwith citations",
    projectId: PROJECT,
    idempotencyKey: "agent-team-1",
    tasks: [
      {
        key: "plan",
        role: "planner",
        title: "Plan",
        instructions: "Create a bounded plan\nwith evidence",
        dependencies: [],
        checkpoint: false,
        reusableSubplan: "Reuse verified sources",
      },
    ],
    context: ["Approved context"],
  });
});

test("rejects unknown fields, null tasks, invalid roles, and unbounded task text", () => {
  expectAgentError(
    () => parseAgentTeamCreatePayload(validTeam({ unexpected: true })),
    { code: "invalid_agent_team" },
  );
  expectAgentError(
    () => parseAgentTeamCreatePayload(validTeam({ tasks: [null] })),
    { code: "invalid_agent_team" },
  );
  expectAgentError(
    () =>
      parseAgentTeamCreatePayload(
        validTeam({
          tasks: [{ ...validTeam().tasks[0], role: "administrator" }],
        }),
      ),
    { code: "invalid_agent_team" },
  );
  expectAgentError(
    () =>
      parseAgentTeamCreatePayload(
        validTeam({
          tasks: [{ ...validTeam().tasks[0], instructions: "x".repeat(8001) }],
        }),
      ),
    { code: "invalid_agent_team" },
  );
  expectAgentError(
    () =>
      parseAgentTeamCreatePayload(
        validTeam({
          tasks: [{ ...validTeam().tasks[0], dependencies: ["plan", "plan"] }],
        }),
      ),
    { code: "invalid_agent_team" },
  );
  expectAgentError(
    () =>
      parseAgentTeamCreatePayload(
        validTeam({ tasks: [{ ...validTeam().tasks[0], elevated: true }] }),
      ),
    { code: "invalid_agent_team" },
  );
});

test("rejects invalid optional identifiers instead of treating them as absent", () => {
  for (const projectId of [null, "", "not-a-uuid"]) {
    expectAgentError(
      () => parseAgentTeamCreatePayload(validTeam({ projectId })),
      { code: "invalid_agent_team" },
    );
  }
});

test("checks collection caps before traversing attacker-controlled entries", () => {
  const tasks = new Array(AGENT_TEAM_MAX_TASKS + 1);
  Object.defineProperty(tasks, 0, {
    get() {
      throw new Error("task entry traversed");
    },
  });
  expectAgentError(() => parseAgentTeamCreatePayload(validTeam({ tasks })), {
    code: "invalid_agent_team",
  });

  const context = new Array(31);
  Object.defineProperty(context, 0, {
    get() {
      throw new Error("context entry traversed");
    },
  });
  expectAgentError(() => parseAgentTeamCreatePayload(validTeam({ context })), {
    code: "invalid_agent_team",
  });

  const dependencies = new Array(AGENT_TEAM_MAX_TASKS + 1);
  Object.defineProperty(dependencies, 0, {
    get() {
      throw new Error("dependency traversed");
    },
  });
  expectAgentError(
    () =>
      parseAgentTeamCreatePayload(
        validTeam({ tasks: [{ ...validTeam().tasks[0], dependencies }] }),
      ),
    { code: "invalid_agent_team" },
  );
});

test("enforces exact run control commands and approval pairing", () => {
  assert.deepEqual(
    parseAgentRunControlPayload({ runId: RUN, command: "pause" }),
    {
      runId: RUN,
      command: "pause",
    },
  );
  assert.deepEqual(
    parseAgentRunControlPayload({
      runId: RUN.toUpperCase(),
      command: "deny",
      approvalId: APPROVAL.toUpperCase(),
    }),
    { runId: RUN, command: "deny", approvalId: APPROVAL },
  );

  for (const value of [
    { runId: RUN, command: "deny" },
    { runId: RUN, command: "pause", approvalId: APPROVAL },
    { runId: RUN, command: "pause", approvalId: null },
    { runId: RUN, command: "execute" },
    { runId: RUN, command: "pause", extra: true },
  ]) {
    expectAgentError(() => parseAgentRunControlPayload(value), {
      code: "invalid_control_request",
    });
  }
});

test("enforces exact team controls and task pairing", () => {
  assert.deepEqual(
    parseAgentTeamControlPayload({ runId: RUN, command: "retry" }),
    {
      runId: RUN,
      command: "retry",
    },
  );
  assert.deepEqual(
    parseAgentTeamControlPayload({
      runId: RUN,
      command: "approve",
      taskId: TASK,
    }),
    { runId: RUN, command: "approve", taskId: TASK },
  );

  for (const value of [
    { runId: RUN, command: "approve" },
    { runId: RUN, command: "retry", taskId: TASK },
    { runId: RUN, command: "delete" },
    { runId: RUN, command: "cancel", extra: true },
  ]) {
    expectAgentError(() => parseAgentTeamControlPayload(value), {
      code: "invalid_agent_control",
    });
  }
});

test("allows only one valid runId query parameter", () => {
  assert.deepEqual(parseAgentRunQuery(new URLSearchParams()), {
    runId: undefined,
  });
  assert.deepEqual(
    parseAgentRunQuery(new URLSearchParams({ runId: RUN.toUpperCase() })),
    {
      runId: RUN,
    },
  );
  for (const query of [
    new URLSearchParams("runId="),
    new URLSearchParams("runId=not-a-uuid"),
    new URLSearchParams(`runId=${RUN}&runId=${OTHER_PROJECT}`),
    new URLSearchParams(`runId=${RUN}&ownerId=someone-else`),
  ]) {
    expectAgentError(() => parseAgentRunQuery(query), {
      code: "invalid_agent_run_id",
    });
  }
});

test("requires JSON and maps malformed bodies to stable public errors", async () => {
  await expectAgentErrorAsync(
    readAgentJsonRequest(
      new Request("https://example.test/api/agents/teams", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
      AGENT_TEAM_CREATE_BODY_LIMIT_BYTES,
    ),
    { code: "unsupported_media_type", status: 415 },
  );

  await expectAgentErrorAsync(
    readAgentJsonRequest(
      new Request("https://example.test/api/agents/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      AGENT_TEAM_CREATE_BODY_LIMIT_BYTES,
    ),
    { code: "invalid_request_body", status: 400 },
  );

  await expectAgentErrorAsync(
    readAgentJsonRequest(
      new Request("https://example.test/api/agents/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      }),
      AGENT_TEAM_CREATE_BODY_LIMIT_BYTES,
    ),
    { code: "invalid_request_body", status: 400 },
  );
});

test("rejects declared and streaming body overflow before JSON parsing", async () => {
  await expectAgentErrorAsync(
    readAgentJsonRequest(
      new Request("https://example.test/api/agents/runs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(AGENT_RUN_CONTROL_BODY_LIMIT_BYTES + 1),
        },
        body: "{}",
      }),
      AGENT_RUN_CONTROL_BODY_LIMIT_BYTES,
    ),
    { code: "request_too_large", status: 413 },
  );

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"a":'));
      controller.enqueue(encoder.encode("12345}"));
      controller.close();
    },
  });
  await expectAgentErrorAsync(
    readAgentJsonRequest(
      new Request("https://example.test/api/agents/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      }),
      8,
    ),
    { code: "request_too_large", status: 413 },
  );
});

function projectClient({
  visibleProjectIds = [],
  error = null,
  throws = false,
} = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: "from", table });
      let requestedId;
      const query = {
        select(columns) {
          calls.push({ operation: "select", table, columns });
          return query;
        },
        eq(column, value) {
          calls.push({ operation: "eq", table, column, value });
          requestedId = value;
          return query;
        },
        async maybeSingle() {
          calls.push({ operation: "maybeSingle", table });
          if (throws) throw new Error("database connection failed");
          if (error) return { data: null, error };
          return {
            data: visibleProjectIds.includes(requestedId)
              ? { id: requestedId }
              : null,
            error: null,
          };
        },
      };
      return query;
    },
  };
}

test("authorizes only projects visible through the caller's RLS client", async () => {
  const client = projectClient({ visibleProjectIds: [PROJECT] });
  assert.equal(
    await authorizeAgentProject({ supabaseUser: client, projectId: PROJECT }),
    PROJECT,
  );
  await expectAgentErrorAsync(
    authorizeAgentProject({ supabaseUser: client, projectId: OTHER_PROJECT }),
    { code: "agent_project_forbidden", status: 403 },
  );
  assert.deepEqual(
    client.calls
      .filter((call) => call.operation === "from")
      .map((call) => call.table),
    ["projects", "projects"],
  );
});

test("omitted projects require no database lookup", async () => {
  const client = projectClient();
  assert.equal(
    await authorizeAgentProject({ supabaseUser: client }),
    undefined,
  );
  assert.deepEqual(client.calls, []);
});

test("project authorization fails closed before downstream service work", async () => {
  for (const client of [
    projectClient({ error: { code: "db_down", details: "private detail" } }),
    projectClient({ throws: true }),
  ]) {
    let serviceCalls = 0;
    await expectAgentErrorAsync(
      authorizeAgentProject({ supabaseUser: client, projectId: PROJECT }).then(
        () => {
          serviceCalls += 1;
        },
      ),
      { code: "agent_project_authorization_unavailable", status: 503 },
    );
    assert.equal(serviceCalls, 0);
  }
});
