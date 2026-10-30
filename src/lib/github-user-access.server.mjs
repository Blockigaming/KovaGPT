import { readProviderJsonObject } from "./provider-response.server.mjs";

const PAGE_SIZE = 30;
const MAX_INSTALLATIONS = 60;
const MAX_REPOSITORIES = 1000;
const id = (value) => Number.isSafeInteger(value) && value > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("invalid_github_discovery_response");

// Both endpoints are scoped by GitHub to this App's authenticated user token.
// Never exchange a deployment-wide App JWT for a more powerful installation token.
// https://docs.github.com/en/rest/apps/installations?apiVersion=2022-11-28
export async function discoverGitHubUserRepositories(
  token,
  githubUserId,
  fetchImpl = fetch,
  operationSignal,
) {
  if (typeof token !== "string" || !token || !id(githubUserId))
    throw new Error("github_reconnect_required");
  const signal = operationSignal
    ? AbortSignal.any([AbortSignal.timeout(15_000), operationSignal])
    : AbortSignal.timeout(15_000);
  let requests = 0;
  async function get(path, page) {
    if (++requests > 50) throw new Error("github_discovery_limit");
    signal.throwIfAborted();
    const url = new URL(path, "https://api.github.com");
    if (page) {
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
    }
    const response = await fetchImpl(url.href, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401
          ? "github_reconnect_required"
          : response.status === 403
            ? "github_access_or_rate_limit_required"
            : "github_discovery_failed",
      );
    }
    return readProviderJsonObject(response, 512_000);
  }
  async function list(path, key, limit) {
    const rows = [],
      seen = new Set();
    let total;
    for (let page = 1; ; page++) {
      const data = await get(path, page);
      if (
        !Number.isSafeInteger(data.total_count) ||
        data.total_count < 0 ||
        !Array.isArray(data[key]) ||
        data[key].length > PAGE_SIZE ||
        (total !== undefined && total !== data.total_count)
      )
        throw invalid();
      total = data.total_count;
      if (total > limit) throw new Error("github_discovery_limit");
      for (const row of data[key]) {
        if (!object(row) || !id(row.id) || seen.has(row.id)) throw invalid();
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length > total) throw invalid();
      if (rows.length === total) return rows;
      if (data[key].length !== PAGE_SIZE) throw invalid();
    }
  }
  const profile = await get("/user");
  if (profile.id !== githubUserId) throw new Error("github_account_identity_mismatch");
  const installations = await list("/user/installations", "installations", MAX_INSTALLATIONS);
  const result = [],
    repositoryIds = new Set();
  let repositoryCount = 0;
  for (const installation of installations) {
    if (
      !object(installation.account) ||
      !id(installation.account.id) ||
      !["User", "Organization"].includes(installation.account.type) ||
      typeof installation.account.login !== "string" ||
      !installation.account.login ||
      !["all", "selected"].includes(installation.repository_selection) ||
      !object(installation.permissions) ||
      !Array.isArray(installation.events) ||
      installation.events.some((event) => typeof event !== "string" || event.length > 100) ||
      (installation.suspended_at !== null &&
        (typeof installation.suspended_at !== "string" ||
          !Number.isFinite(Date.parse(installation.suspended_at))))
    )
      throw invalid();
    const repositories = installation.suspended_at
      ? []
      : await list(
          `/user/installations/${installation.id}/repositories`,
          "repositories",
          MAX_REPOSITORIES - repositoryCount,
        );
    for (const repo of repositories) {
      if (
        typeof repo.full_name !== "string" ||
        repo.full_name.length > 200 ||
        !/^[a-z\d-]+\/[a-z\d._-]+$/iu.test(repo.full_name) ||
        [".", ".."].includes(repo.full_name.split("/")[1]) ||
        !["public", "private", "internal"].includes(repo.visibility) ||
        typeof repo.default_branch !== "string" ||
        !repo.default_branch ||
        typeof repo.archived !== "boolean" ||
        !object(repo.permissions) ||
        repo.permissions.pull !== true ||
        repositoryIds.has(repo.id)
      )
        throw invalid();
      repositoryIds.add(repo.id);
      repositoryCount++;
    }
    result.push({ installation, repositories });
  }
  return result;
}
