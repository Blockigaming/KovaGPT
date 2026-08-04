const API = "https://api.github.com";
export class GitHubConnectorError extends Error {
  constructor(code, message, status, retryAfter) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export class GitHubClient {
  constructor({ token, allowedRepositories, fetchImpl = fetch, apiBase = API }) {
    if (!token) throw new Error("GitHub token required");
    this.token = token;
    this.allowed = new Set(allowedRepositories);
    this.fetch = fetchImpl;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.rateLimit = null;
  }
  assertRepo(repo) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !this.allowed.has(repo.toLowerCase()))
      throw new GitHubConnectorError(
        "repository_not_authorized",
        "Repository is not explicitly authorized",
        403,
      );
  }
  async request(path, { method = "GET", body, confirm = false, repo } = {}) {
    if (repo) this.assertRepo(repo);
    if (method !== "GET" && !confirm)
      throw new GitHubConnectorError(
        "confirmation_required",
        "Explicit confirmation is required",
        409,
      );
    const response = await this.fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    this.rateLimit = {
      limit: Number(response.headers.get("x-ratelimit-limit") || 0),
      remaining: Number(response.headers.get("x-ratelimit-remaining") || 0),
      reset: Number(response.headers.get("x-ratelimit-reset") || 0),
    };
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after") || 0) || undefined;
      throw new GitHubConnectorError(
        response.status === 401
          ? "authorization_lost"
          : response.status === 403 && this.rateLimit.remaining === 0
            ? "rate_limited"
            : "provider_error",
        `GitHub request failed (${response.status})`,
        response.status,
        retry,
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async paginate(path, options = {}) {
    const results = [];
    for (let page = 1; page <= 20; page++) {
      const join = path.includes("?") ? "&" : "?",
        data = await this.request(`${path}${join}per_page=100&page=${page}`, options),
        items = Array.isArray(data) ? data : (data.items ?? []);
      results.push(...items);
      if (items.length < 100) break;
    }
    return results;
  }
  listRepositories() {
    return this.paginate(
      "/user/repos?affiliation=owner,collaborator,organization_member&sort=updated",
    );
  }
  searchRepositories(query) {
    return this.paginate(`/search/repositories?q=${encodeURIComponent(query)}`);
  }
  searchCode(repo, query) {
    this.assertRepo(repo);
    return this.paginate(`/search/code?q=${encodeURIComponent(query)}+repo:${repo}`, { repo });
  }
  tree(repo, ref = "HEAD", recursive = true) {
    return this.request(
      `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=${recursive ? 1 : 0}`,
      { repo },
    );
  }
  file(repo, path, ref) {
    return this.request(
      `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
      { repo },
    );
  }
  readme(repo, ref) {
    return this.request(`/repos/${repo}/readme${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, {
      repo,
    });
  }
  branches(repo) {
    return this.paginate(`/repos/${repo}/branches`, { repo });
  }
  commits(repo) {
    return this.paginate(`/repos/${repo}/commits`, { repo });
  }
  pulls(repo, state = "open") {
    return this.paginate(`/repos/${repo}/pulls?state=${state}`, { repo });
  }
  issues(repo, state = "open") {
    return this.paginate(`/repos/${repo}/issues?state=${state}`, { repo });
  }
  releases(repo) {
    return this.paginate(`/repos/${repo}/releases`, { repo });
  }
  workflows(repo) {
    return this.paginate(`/repos/${repo}/actions/workflows`, { repo });
  }
  workflowRuns(repo) {
    return this.paginate(`/repos/${repo}/actions/runs`, { repo });
  }
  checks(repo, ref) {
    return this.paginate(`/repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs`, { repo });
  }
  discussions(repo) {
    return this.request(`/repos/${repo}/discussions`, { repo });
  }
  createIssue(repo, input, confirm) {
    return this.request(`/repos/${repo}/issues`, { method: "POST", body: input, confirm, repo });
  }
  commentIssue(repo, number, body, confirm) {
    return this.request(`/repos/${repo}/issues/${number}/comments`, {
      method: "POST",
      body: { body },
      confirm,
      repo,
    });
  }
  updateIssue(repo, number, state, confirm) {
    return this.request(`/repos/${repo}/issues/${number}`, {
      method: "PATCH",
      body: { state },
      confirm,
      repo,
    });
  }
  createBranch(repo, name, sha, confirm) {
    return this.request(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${name}`, sha },
      confirm,
      repo,
    });
  }
  createCommit(repo, input, confirm) {
    return this.request(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: input,
      confirm,
      repo,
    });
  }
  createBlob(repo, content, encoding = "utf-8", confirm) {
    return this.request(`/repos/${repo}/git/blobs`, {
      method: "POST",
      body: { content, encoding },
      confirm,
      repo,
    });
  }
  createTree(repo, baseTree, entries, confirm) {
    return this.request(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: { base_tree: baseTree, tree: entries },
      confirm,
      repo,
    });
  }
  updateBranch(repo, branch, sha, force, confirm) {
    if (force)
      throw new GitHubConnectorError("protected_operation", "Force updates are not allowed", 409);
    return this.request(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      body: { sha, force: false },
      confirm,
      repo,
    });
  }
  async proposePatch(repo, input, confirm) {
    if (!confirm)
      throw new GitHubConnectorError(
        "confirmation_required",
        "Explicit confirmation is required",
        409,
      );
    if (input.branch === input.defaultBranch)
      throw new GitHubConnectorError(
        "protected_operation",
        "Patches require a separate branch",
        409,
      );
    const blobs = [];
    for (const file of input.files)
      blobs.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: (await this.createBlob(repo, file.content, "utf-8", true)).sha,
      });
    const tree = await this.createTree(repo, input.baseTree, blobs, true);
    const commit = await this.createCommit(
      repo,
      { message: input.message, tree: tree.sha, parents: [input.parentSha] },
      true,
    );
    await this.updateBranch(repo, input.branch, commit.sha, false, true);
    return { tree, commit };
  }
  openPull(repo, input, confirm) {
    return this.request(`/repos/${repo}/pulls`, { method: "POST", body: input, confirm, repo });
  }
  commentPull(repo, number, body, confirm) {
    return this.commentIssue(repo, number, body, confirm);
  }
  requestReview(repo, number, reviewers, confirm) {
    return this.request(`/repos/${repo}/pulls/${number}/requested_reviewers`, {
      method: "POST",
      body: { reviewers },
      confirm,
      repo,
    });
  }
  mergePull(repo, number, input, confirm) {
    return this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: input,
      confirm,
      repo,
    });
  }
}
export async function verifyGitHubWebhook({ secret, signature, body }) {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = `sha256=${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}
