import { approvedMcpServers } from "./approved-mcp-servers.server.mjs";
import { REVIEWED_MCP_WRITE_SCOPE } from "./connection-flows.mjs";

// Credential bindings stay encrypted alongside their secrets. Chat inputs
// cannot switch a linked credential to a different team, project, or region.
export const MIXPANEL_ORIGINS = Object.freeze({
  us: "https://mixpanel.com",
  eu: "https://eu.mixpanel.com",
  in: "https://in.mixpanel.com",
});
export const WEBULL_ORIGINS = Object.freeze({
  production: "https://api.webull.com",
  sandbox: "https://api.sandbox.webull.com",
});

const numericId = /^[1-9][0-9]{0,19}$/u;
const clientIdentifier = /^[A-Za-z0-9_-]{8,200}$/u;

export function prepareKeyCredential(provider, input) {
  const field = (name) => (typeof input?.[name] === "string" ? input[name].trim() : "");
  const apiKey = field("apiKey");
  const secretPattern = provider === "sp-global" ? /^[ -~]{8,512}$/u : /^[!-~]{8,512}$/u;
  if (!secretPattern.test(apiKey)) throw new Error("invalid_connection_credential");

  let binding;
  let addedScopes;
  let accountId = "personal-api-key";
  let labelSuffix = "";
  if (provider === "vercel") {
    const teamId = field("teamId");
    if (!/^team_[A-Za-z0-9]{1,128}$/u.test(teamId))
      throw new Error("invalid_connection_credential");
    binding = { teamId };
    accountId = teamId;
    labelSuffix = `team ending ${teamId.slice(-6)}`;
  } else if (provider === "mixpanel") {
    const username = field("username");
    const projectId = field("projectId");
    const workspaceId = field("workspaceId");
    const region = field("region");
    const numericId = /^[1-9][0-9]{0,14}$/u;
    if (
      !/^[A-Za-z0-9@._-]{1,200}$/u.test(username) ||
      !numericId.test(projectId) ||
      (workspaceId && !numericId.test(workspaceId)) ||
      !Object.hasOwn(MIXPANEL_ORIGINS, region)
    )
      throw new Error("invalid_connection_credential");
    binding = { username, projectId, workspaceId, region };
    accountId = `${region}:${projectId}:${workspaceId}`;
    labelSuffix = `project ${projectId}${workspaceId ? ` · workspace ${workspaceId}` : ""}`;
  } else if (provider === "etoro") {
    const userKey = field("userKey");
    if (!/^[!-~]{8,512}$/u.test(userKey)) throw new Error("invalid_connection_credential");
    binding = { userKey };
    labelSuffix = "real portfolio";
  } else if (provider === "interactive-brokers") {
    const queryId = field("queryId");
    if (!numericId.test(queryId) || !/^[0-9]{8,100}$/u.test(apiKey))
      throw new Error("invalid_connection_credential");
    binding = { queryId };
    accountId = queryId;
    labelSuffix = `Flex query ending ${queryId.slice(-4)}`;
  } else if (provider === "sp-global") {
    const username = field("username");
    if (!/^[A-Za-z0-9@._+\-]{1,200}$/u.test(username))
      throw new Error("invalid_connection_credential");
    binding = { username };
    labelSuffix = "Capital IQ API";
  } else if (provider === "webull") {
    const appKey = field("appKey");
    const environment = field("environment");
    const accessToken = field("accessToken");
    if (
      !clientIdentifier.test(appKey) ||
      !Object.hasOwn(WEBULL_ORIGINS, environment) ||
      (accessToken && !/^[!-~]{8,512}$/u.test(accessToken))
    )
      throw new Error("invalid_connection_credential");
    binding = { appKey, environment, accessToken };
    accountId = environment;
    labelSuffix = environment;
  } else if (provider === "wix") {
    const clientId = field("clientId");
    if (!clientIdentifier.test(clientId)) throw new Error("invalid_connection_credential");
    binding = { clientId };
    accountId = clientId;
    labelSuffix = `project ending ${clientId.slice(-6)}`;
  } else if (provider === "notion-private") {
    const compact = field("pageId").toLowerCase().replaceAll("-", "");
    if (!/^[a-f0-9]{32}$/u.test(compact)) throw new Error("invalid_connection_credential");
    const pageId = compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
    binding = { pageId };
    accountId = pageId;
    labelSuffix = `page ending ${compact.slice(-6)}`;
  } else if (provider === "custom-mcp") {
    const serverId = field("serverId");
    const server = approvedMcpServers().get(serverId);
    if (!server || !/^[A-Za-z0-9._~+\/=-]{8,512}$/u.test(apiKey))
      throw new Error("invalid_connection_credential");
    binding = { serverId, bindingHash: server.fingerprint };
    if (server.write) {
      binding.writeFingerprint = server.write.fingerprint;
      addedScopes = [REVIEWED_MCP_WRITE_SCOPE];
    }
    accountId = serverId;
    labelSuffix = serverId;
  }
  return {
    token: binding ? JSON.stringify({ apiKey, ...binding }) : apiKey,
    accountId,
    labelSuffix,
    ...(addedScopes ? { addedScopes } : {}),
  };
}

export function unpackKeyCredential(provider, token) {
  let value;
  try {
    value = JSON.parse(token);
  } catch {
    throw new Error("invalid_connection_credential");
  }
  const validated = JSON.parse(prepareKeyCredential(provider, value).token);
  if (provider === "custom-mcp") {
    if (validated.bindingHash !== value.bindingHash)
      throw new Error("connection_changed_or_expired");
    if (validated.writeFingerprint !== value.writeFingerprint) delete validated.writeFingerprint;
  }
  return validated;
}
