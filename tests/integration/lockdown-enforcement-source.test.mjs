import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

function before(text, guard, operation, label) {
  const guardIndex = text.indexOf(guard);
  const operationIndex = text.indexOf(operation);
  assert.notEqual(guardIndex, -1, `${label}: missing ${guard}`);
  assert.notEqual(operationIndex, -1, `${label}: missing ${operation}`);
  assert.ok(guardIndex < operationIndex, `${label}: policy must run before network operation`);
}

test("chat blocks explicit and implicit network tools before provider work", async () => {
  const chat = await source("src/routes/api/chat.ts");
  before(chat, "readLockdownMode(", "handleDeepResearchRequest(lastText", "deep research");
  before(chat, "readLockdownMode(", "runWebSearch(", "web search");
  assert.match(
    chat,
    /!lockdownBlocksNetwork\s*&&\s*\(!customKova \|\| customKova\.allows\("web"\)\)\s*&&\s*lastText/u,
  );
  assert.match(chat, /clientTool === "deep_research"\s*\? "deep_research"/u);
  assert.match(chat, /clientTool === "web_search"\s*\? "live_web"/u);
});

test("local weather is authenticated, bounded, rate-limited, and blocked as live web", async () => {
  const [weather, summary] = await Promise.all([
    source("src/routes/api/weather.ts"),
    source("src/routes/summary.tsx"),
  ]);
  before(weather, "requireUser(", "api.open-meteo.com", "weather authentication");
  before(weather, '"live_web"', "api.open-meteo.com", "weather Lockdown policy");
  before(weather, "consumeApplicationRateLimit(", "api.open-meteo.com", "weather rate limit");
  assert.match(weather, /unsupported_media_type/u);
  assert.match(weather, /readBoundedJsonObject\(request, 1024\)/u);
  assert.match(weather, /readProviderJsonObject\(response, MAX_RESPONSE_BYTES\)/u);
  assert.doesNotMatch(summary, /api\.open-meteo\.com/u);
  assert.match(summary, /authFetch\("\/api\/weather"/u);
});

test("OAuth callbacks re-check the account after state validation and before exchange", async () => {
  const [github, generic, google] = await Promise.all([
    source("src/lib/github-oauth.server.ts"),
    source("src/integrations/oauth-lifecycle.server.ts"),
    source("src/routes/api/google/callback.ts"),
  ]);
  before(
    github.slice(github.indexOf("export async function completeGitHubOAuth")),
    "assertLockdownAllows(",
    'fetch("https://github.com/login/oauth/access_token"',
    "GitHub OAuth callback",
  );
  before(
    generic.slice(generic.indexOf("export async function completeOAuth")),
    "assertLockdownAllows(",
    "fetch(provider.tokenEndpoint",
    "generic OAuth callback",
  );
  before(
    google.slice(google.indexOf("const userId = await verifyState(state)")),
    "assertLockdownAllows(",
    "finishGoogleOAuth(",
    "Google OAuth callback before claimed credential exchange",
  );
});

test("connector and remote-download boundaries enforce Lockdown Mode", async () => {
  const files = {
    githubTool: await source("src/routes/api/github/tool.ts"),
    githubManagement: await source("src/lib/github.functions.ts"),
    googleTools: await source("src/lib/google-tools.server.ts"),
    googleStatus: await source("src/routes/api/google/status.ts"),
    summaries: await source("src/lib/summary.functions.ts"),
    images: await source("src/lib/library-images.functions.ts"),
    finance: await source("src/finances/plaid.server.ts"),
  };
  before(files.githubTool, "enforceLockdownCapability(", "new GitHubClient({", "GitHub tool");
  before(
    files.githubManagement,
    "assertLockdownAllows(",
    "listGitHubAppInstallations()",
    "GitHub installation refresh",
  );
  before(files.googleTools, "assertLockdownAllows(", "getGoogleConnectionHealth(", "Google tools");
  before(
    files.googleStatus,
    "enforceLockdownCapability(",
    "getGoogleAccountsHealth(",
    "Google connection status",
  );
  before(
    files.summaries,
    "assertLockdownAllows(",
    "getValidGoogleAccessToken(",
    "Google summaries",
  );
  before(files.images, "assertLockdownAllows(", "fetchRemoteImage(data.imageUrl)", "remote image");
  before(files.finance, "assertLockdownAllows(", "call<{ link_token:", "finance connector");
});

test("Canvas previews are network-isolated even before account policy is consulted", async () => {
  const previews = await source("src/components/artifact-utils.ts");
  assert.match(previews, /Content-Security-Policy/u);
  assert.match(previews, /default-src 'none'/u);
  assert.match(previews, /img-src data: blob:/u);
  assert.doesNotMatch(previews, /connect-src/u);
});

test("agent creation and continuation are protected while safe controls remain available", async () => {
  const [runRoute, teamRoute, execution, team] = await Promise.all([
    source("src/routes/api/agents/runs.ts"),
    source("src/routes/api/agents/teams.ts"),
    source("src/agents/execution.server.ts"),
    source("src/agents/team.server.ts"),
  ]);
  assert.match(runRoute, /enforceLockdownCapability\([\s\S]*?"agent"/u);
  assert.doesNotMatch(
    teamRoute.slice(teamRoute.indexOf("POST:"), teamRoute.indexOf("PATCH:")),
    /enforceLockdownCapability/u,
  );
  before(
    execution.slice(execution.indexOf("export async function createAgentRun")),
    "assertLockdownAllows(",
    "getAgentEntitlement(",
    "agent run",
  );
  before(
    team.slice(team.indexOf("export async function createAgentTeamRun")),
    "assertLockdownAllows(",
    'throw new Error("agent_team_execution_unavailable")',
    "agent team",
  );
  assert.match(execution, /if \(command === "resume"\)[\s\S]*?assertLockdownAllows/u);
  assert.match(team, /command !== "cancel" && command !== "deny"/u);
  assert.doesNotMatch(execution, /if \(command === "cancel"\)[\s\S]{0,120}assertLockdownAllows/u);
});
