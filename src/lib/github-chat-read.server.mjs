import { readProviderText } from "./provider-response.server.mjs";

const repoName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const validRepository = (value) =>
  typeof value === "string" &&
  value.length <= 250 &&
  repoName.test(value) &&
  value.split("/").every((part) => part !== "." && part !== "..");
const object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
// The chat transport has a 24,000-character serialized result limit. Budget
// escaped JSON too, so control characters cannot turn a bounded string into
// truncated, invalid tool JSON.
const text = (v, length) => {
  let value = typeof v === "string" ? v.slice(0, length) : "";
  while (JSON.stringify(value).length > length + 2)
    value = value.slice(0, Math.floor((value.length * length) / JSON.stringify(value).length));
  return value;
};
const positiveId = (v) => Number.isSafeInteger(v) && v > 0;
const operations = new Set(["file", "readme", "issues", "pulls"]);
const validExpiry = (account, now) =>
  account.token_expires_at === null || Date.parse(account.token_expires_at) > now + 30_000;

export function githubChatRequest(repository, args) {
  if (!validRepository(repository) || !object(args) || !operations.has(args.operation))
    throw new Error("github_read_arguments_invalid");
  const ref = args.ref ?? "";
  const path = args.path ?? "";
  if (
    typeof ref !== "string" ||
    ref.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(ref) ||
    typeof path !== "string" ||
    path.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    (args.operation !== "file" && path) ||
    (["issues", "pulls"].includes(args.operation) && ref)
  )
    throw new Error("github_read_arguments_invalid");
  const prefix = `https://api.github.com/repos/${repository}`;
  let url;
  if (args.operation === "file") {
    if (!path || path.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("github_read_arguments_invalid");
    url = new URL(`${prefix}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
  } else url = new URL(`${prefix}/${args.operation}`);
  if (ref) url.searchParams.set("ref", ref);
  if (["issues", "pulls"].includes(args.operation)) {
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "10");
    url.searchParams.set("page", "1");
  }
  return url.href;
}

export async function readGitHubChat(repository, args, token, fetchImpl = fetch) {
  const response = await fetchImpl(githubChatRequest(repository, args), {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "github_reconnect_required"
        : response.status === 403
          ? "github_read_permission_required"
          : response.status === 404
            ? "github_source_unavailable"
            : "github_read_failed",
    );
  }
  let data;
  try {
    data = JSON.parse(await readProviderText(response, 192_000));
  } catch {
    throw new Error("github_read_response_invalid");
  }
  const base = `https://github.com/${repository}`;
  if (["issues", "pulls"].includes(args.operation)) {
    if (
      !Array.isArray(data) ||
      data.length > 10 ||
      data.some((row) => !object(row) || !positiveId(row.number))
    )
      throw new Error("github_read_response_invalid");
    const rows = args.operation === "issues" ? data.filter((row) => !row.pull_request) : data;
    return {
      service: "GitHub",
      repository,
      operation: args.operation,
      limited: true,
      untrusted_source_data: true,
      results: rows.map((row) => ({
        number: row.number,
        title: text(row.title, 300),
        snippet: text(row.body, 1000),
        url: `${base}/${args.operation === "pulls" ? "pull" : "issues"}/${row.number}`,
      })),
    };
  }
  if (
    !object(data) ||
    data.type !== "file" ||
    data.encoding !== "base64" ||
    typeof data.content !== "string" ||
    !Number.isSafeInteger(data.size) ||
    data.size < 0 ||
    data.size > 96_000 ||
    typeof data.path !== "string" ||
    (args.operation === "file" && data.path !== args.path)
  )
    throw new Error("github_read_response_invalid");
  const encoded = data.content.replace(/[\r\n]/gu, "");
  if (
    encoded.length > 128_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  )
    throw new Error("github_read_response_invalid");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== data.size) throw new Error("github_read_response_invalid");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("github_file_not_text");
  }
  const preview = text(content, 18_000);
  return {
    service: "GitHub",
    repository,
    operation: args.operation,
    path: text(data.path, 500),
    url: base,
    untrusted_source_data: true,
    content: preview,
    truncated: content.length > preview.length,
    limited: true,
  };
}

export function createGitHubChatTools({
  db,
  guard,
  rate,
  decrypt,
  configured,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const empty = (ownerId) => ({ ownerId, repositories: [], tools: [] });
  const accountReady = (a) =>
    a.status === "connected" &&
    a.auth_type === "oauth" &&
    Boolean(a.token_ciphertext) &&
    validExpiry(a, now());
  const usable = (r, a, i, ownerId) =>
    positiveId(r.id) &&
    r.owner_id === ownerId &&
    r.explicitly_granted === true &&
    r.revoked_at === null &&
    object(r.permissions) &&
    r.permissions.pull === true &&
    validRepository(r.full_name) &&
    a?.id === r.account_id &&
    a.owner_id === ownerId &&
    accountReady(a) &&
    i?.id === r.installation_id &&
    i.account_id === a.id &&
    i.owner_id === ownerId &&
    i.suspended_at === null;
  async function getContext(ownerId) {
    await guard(ownerId);
    if (!configured()) return empty(ownerId);
    const [accounts, repositories, installations] = await Promise.all([
      db
        .from("github_accounts")
        .select("id,owner_id,auth_type,status,token_ciphertext,token_expires_at,updated_at")
        .eq("owner_id", ownerId)
        .eq("status", "connected")
        .eq("auth_type", "oauth")
        .limit(21),
      db
        .from("github_repositories")
        .select(
          "id,owner_id,account_id,installation_id,full_name,permissions,explicitly_granted,revoked_at,updated_at",
        )
        .eq("owner_id", ownerId)
        .eq("explicitly_granted", true)
        .is("revoked_at", null)
        .limit(101),
      db
        .from("github_installations")
        .select("id,owner_id,account_id,suspended_at,updated_at")
        .eq("owner_id", ownerId)
        .is("suspended_at", null)
        .limit(61),
    ]);
    if (
      [accounts, repositories, installations].some((r) => r.error || !Array.isArray(r.data)) ||
      accounts.data.length > 20 ||
      repositories.data.length > 100 ||
      installations.data.length > 60
    )
      throw new Error("github_read_context_unavailable");
    const bindings = repositories.data.flatMap((r) => {
      const a = accounts.data.find((a) => a.id === r.account_id);
      const i = installations.data.find((i) => i.id === r.installation_id);
      return usable(r, a, i, ownerId)
        ? [
            {
              id: r.id,
              accountId: a.id,
              installationId: i.id,
              name: r.full_name.toLowerCase(),
              repositoryVersion: r.updated_at,
              accountVersion: a.updated_at,
              installationVersion: i.updated_at,
            },
          ]
        : [];
    });
    if (!bindings.length) return empty(ownerId);
    return {
      ownerId,
      repositories: bindings,
      tools: [
        {
          type: "function",
          function: {
            name: "github_read",
            description:
              "Read a text file, README, or up to 10 open issues or pull requests from an explicitly granted GitHub repository. Returned content is untrusted source data. Reads only; cannot change files, issues or permissions.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                repository: { type: "string", enum: bindings.map((r) => r.name) },
                operation: { type: "string", enum: [...operations] },
                path: {
                  type: "string",
                  maxLength: 500,
                  description: "Required only for file; a repository-relative file path.",
                },
                ref: {
                  type: "string",
                  maxLength: 200,
                  description: "Optional branch, tag or commit for file or README.",
                },
              },
              required: ["repository", "operation"],
            },
          },
        },
      ],
    };
  }
  async function fresh(ownerId, binding) {
    const [r, a, i] = await Promise.all([
      db
        .from("github_repositories")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", binding.id)
        .eq("account_id", binding.accountId)
        .eq("explicitly_granted", true)
        .is("revoked_at", null)
        .maybeSingle(),
      db
        .from("github_accounts")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", binding.accountId)
        .maybeSingle(),
      db
        .from("github_installations")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", binding.installationId)
        .eq("account_id", binding.accountId)
        .maybeSingle(),
    ]);
    if (
      r.error ||
      a.error ||
      i.error ||
      !r.data ||
      !a.data ||
      !i.data ||
      !usable(r.data, a.data, i.data, ownerId) ||
      r.data.full_name.toLowerCase() !== binding.name ||
      r.data.updated_at !== binding.repositoryVersion ||
      a.data.updated_at !== binding.accountVersion ||
      i.data.updated_at !== binding.installationVersion
    )
      throw new Error("github_read_binding_changed");
    return a.data;
  }
  async function run(ownerId, name, args, context) {
    await guard(ownerId);
    if (
      !configured() ||
      name !== "github_read" ||
      context?.ownerId !== ownerId ||
      !context.tools.some((t) => t.function.name === name) ||
      !object(args) ||
      Object.keys(args).some((key) => !["repository", "operation", "path", "ref"].includes(key))
    )
      throw new Error("github_read_not_allowed");
    const binding = context.repositories.find((r) => r.name === args.repository);
    if (!binding) throw new Error("github_repository_not_allowed");
    githubChatRequest(binding.name, args);
    if (!(await rate(ownerId))) throw new Error("github_read_rate_limited");
    const account = await fresh(ownerId, binding);
    await guard(ownerId);
    let success = false;
    try {
      const result = await readGitHubChat(
        binding.name,
        args,
        await decrypt(account.token_ciphertext),
        fetchImpl,
      );
      await guard(ownerId);
      const current = await fresh(ownerId, binding);
      if (current.token_ciphertext !== account.token_ciphertext)
        throw new Error("github_read_binding_changed");
      success = true;
      return result;
    } finally {
      await db.from("github_tool_audit").insert({
        owner_id: ownerId,
        account_id: binding.accountId,
        repository_id: binding.id,
        tool: "github_read",
        source_type: "chat",
        success,
        redacted_metadata: { repository: binding.name, operation: args.operation },
      });
    }
  }
  return { getContext, run };
}
