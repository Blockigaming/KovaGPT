// Credential bindings stay encrypted alongside their secrets. Chat inputs
// cannot switch a linked credential to a different team, project, or region.
export const MIXPANEL_ORIGINS = Object.freeze({
  us: "https://mixpanel.com",
  eu: "https://eu.mixpanel.com",
  in: "https://in.mixpanel.com",
});

export function prepareKeyCredential(provider, input) {
  const field = (name) => (typeof input?.[name] === "string" ? input[name].trim() : "");
  const apiKey = field("apiKey");
  if (!/^[!-~]{8,512}$/u.test(apiKey)) throw new Error("invalid_connection_credential");

  let binding;
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
  }
  return {
    token: binding ? JSON.stringify({ apiKey, ...binding }) : apiKey,
    accountId,
    labelSuffix,
  };
}

export function unpackKeyCredential(provider, token) {
  let value;
  try {
    value = JSON.parse(token);
  } catch {
    throw new Error("invalid_connection_credential");
  }
  return JSON.parse(prepareKeyCredential(provider, value).token);
}
