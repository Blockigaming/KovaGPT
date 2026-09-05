import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runsSource = readFileSync(
  new URL("../../src/routes/api/agents/runs.ts", import.meta.url),
  "utf8",
);
const teamsSource = readFileSync(
  new URL("../../src/routes/api/agents/teams.ts", import.meta.url),
  "utf8",
);
const ingressSource = readFileSync(
  new URL("../../src/agents/agent-ingress.server.mjs", import.meta.url),
  "utf8",
);
const authSource = readFileSync(
  new URL("../../src/lib/api-auth.server.ts", import.meta.url),
  "utf8",
);

function handlerSlice(source, method, nextMethod) {
  const start = source.indexOf(`${method}: async ({ request }) => {`);
  assert.ok(start > 0, `${method} handler must exist`);
  const end = nextMethod ? source.indexOf(`${nextMethod}: async ({ request }) => {`, start) : -1;
  return source.slice(start, end > start ? end : undefined);
}

test("enabled agent controls use the shared bounded JSON ingress", () => {
  assert.doesNotMatch(runsSource, /request\.json\s*\(/);
  assert.doesNotMatch(teamsSource, /request\.json\s*\(/);
  assert.match(
    runsSource,
    /readAgentJsonRequest\(\s*request,\s*AGENT_RUN_CONTROL_BODY_LIMIT_BYTES,?\s*\)/,
  );
  assert.match(
    teamsSource,
    /readAgentJsonRequest\(\s*request,\s*AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES,?\s*\)/,
  );
  assert.match(ingressSource, /readBoundedJsonObject\(request, maxBytes\)/);
  assert.match(ingressSource, /mediaType !== "application\/json"/);
});

test("team creation is hard-disabled and cannot leave permanently queued records", () => {
  const post = handlerSlice(teamsSource, "POST", "PATCH");
  const cancelAt = post.indexOf("await request.body?.cancel()");
  const unavailableAt = post.indexOf('error: "agent_team_execution_unavailable"');

  assert.ok(cancelAt > 0, "disabled creation must drain the unread request body");
  assert.ok(unavailableAt > cancelAt, "the unavailable response must follow body cancellation");
  assert.doesNotMatch(post, /enforceLockdownCapability/);
  assert.match(post, /status: 503/);
  assert.match(post, /"Retry-After": "3600"/);
  assert.doesNotMatch(teamsSource, /\bcreateAgentTeamRun\b/);
  assert.doesNotMatch(teamsSource, /parseAgentTeamCreatePayload|authorizeAgentProject/);
});

test("authorization uses the verified bearer-scoped client added to the auth boundary", () => {
  assert.match(authSource, /global:\s*\{ headers:\s*\{ Authorization: `Bearer \$\{token\}` \} \}/);
  assert.match(authSource, /supabaseUser:\s*verifier/);
  assert.match(authSource, /supabaseAdmin,/);
  assert.match(ingressSource, /supabaseUser\s*\.from\("projects"\)/);
  assert.doesNotMatch(ingressSource, /supabaseAdmin/);
});

test("single-agent creation remains hard-disabled and drains the request body", () => {
  const post = handlerSlice(runsSource, "POST", "PATCH");
  const cancelAt = post.indexOf("await request.body?.cancel()");
  const unavailableAt = post.indexOf('error: "browser_agent_unavailable"');

  assert.ok(cancelAt > 0, "disabled creation must cancel unread request bodies");
  assert.ok(unavailableAt > cancelAt, "the disabled response must follow body cancellation");
  assert.match(post, /status: 503/);
  assert.match(post, /"Retry-After": "3600"/);
  assert.doesNotMatch(runsSource, /\bcreateAgentRun\b/);
});

test("strict control parsing precedes every agent control action", () => {
  const runPatch = handlerSlice(runsSource, "PATCH");
  const teamPatch = handlerSlice(teamsSource, "PATCH");

  assert.ok(runPatch.indexOf("readAgentJsonRequest(") < runPatch.indexOf("controlAgentRun("));
  assert.ok(teamPatch.indexOf("readAgentJsonRequest(") < teamPatch.indexOf("controlAgentTeamRun("));
});

test("strict GET query parsing precedes all history reads", () => {
  const runGet = handlerSlice(runsSource, "GET", "POST");
  const teamGet = handlerSlice(teamsSource, "GET", "POST");

  assert.ok(runGet.indexOf("parseAgentRunQuery(") < runGet.indexOf('.from("agent_runs"'));
  assert.ok(teamGet.indexOf("parseAgentRunQuery(") < teamGet.indexOf("getAgentTeamRuns(auth"));
});

test("agent responses do not cache authenticated run data or errors", () => {
  assert.match(runsSource, /"Cache-Control": "no-store"/);
  assert.match(teamsSource, /"Cache-Control": "no-store"/);
  assert.match(runsSource, /RUN_CONTROL_ERRORS\.has\(message\)/);
  assert.match(teamsSource, /TEAM_CONTROL_ERRORS\.has\(message\)/);
  assert.match(teamsSource, /TEAM_CONTROL_CONFLICTS\.has\(message\)/);
  assert.match(teamsSource, /status: conflict \? 409/);
  assert.match(teamsSource, /agent_team_execution_unavailable/);
});
