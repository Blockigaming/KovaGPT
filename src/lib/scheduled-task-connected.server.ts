import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredential } from "@/integrations/credential-vault.server";
import { getValidGoogleAccessToken } from "@/lib/google-oauth.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import { taskResource, type TaskProvider } from "@/lib/scheduled-task-policy.mjs";

export type TaskConnectionGrant = {
  id: string;
  user_id: string;
  provider: TaskProvider;
  connection_ref: string;
  connection_generation: string;
  provider_account_id: string;
  required_scopes: string[];
  expires_at: string;
  revoked_at: string | null;
};
type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  select(fields: string): Query;
  eq(key: string, value: unknown): Query;
  is(key: string, value: null): Query;
  maybeSingle(): Query;
  abortSignal(signal: AbortSignal): Query;
};
type Admin = { rpc(name: string, args: Record<string, unknown>): Query; from(name: string): Query };
const admin = supabaseAdmin as unknown as Admin;
const string = (value: unknown, max = 12000) =>
  typeof value === "string" ? value.slice(0, max) : "";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export class TaskConnectionError extends Error {
  constructor() {
    super("task_connection_unavailable");
  }
}
async function json(url: string, token: string, signal: AbortSignal, grant: TaskConnectionGrant) {
  await assertTaskConnectionCurrent(grant, signal);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new TaskConnectionError();
  const value = await readProviderJsonObject(response, 128000);
  await assertTaskConnectionCurrent(grant, signal);
  return value;
}
export async function assertTaskConnectionCurrent(
  grant: TaskConnectionGrant,
  signal: AbortSignal,
): Promise<void> {
  await assertLockdownAllows(
    {
      from: (table: string) => ({
        select: (fields: string) => ({
          eq: (column: string, value: unknown) => ({
            maybeSingle: () =>
              admin.from(table).select(fields).eq(column, value).maybeSingle().abortSignal(signal),
          }),
        }),
      }),
    },
    grant.user_id,
    "connector_read",
  );
  if (
    grant.revoked_at ||
    !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= Date.now()
  )
    throw new TaskConnectionError();
  const checked = await admin
    .rpc("validate_scheduled_task_connection_grant", {
      p_user_id: grant.user_id,
      p_grant_id: grant.id,
    })
    .abortSignal(signal);
  if (checked.error || checked.data !== true) throw new TaskConnectionError();
}
export async function currentTaskConnectionToken(
  grant: TaskConnectionGrant,
  signal: AbortSignal,
): Promise<string> {
  await assertTaskConnectionCurrent(grant, signal);
  if (grant.provider === "gmail") {
    // This exact binding requires the immutable-connection Google backend. A
    // selected/default account is never passed or accepted as task authority.
    try {
      const token = await getValidGoogleAccessToken(grant.user_id, {
        connectionId: grant.connection_ref,
        grantId: grant.connection_generation,
        expectedGoogleSub: grant.provider_account_id,
        capability: "gmail.read",
      });
      await assertTaskConnectionCurrent(grant, signal);
      return token;
    } catch (error) {
      if (
        error instanceof Error &&
        /google_(?:reauthorization_required|permission_incomplete|connection_changed|not_connected|invalid_account_selection)/u.test(
          error.message,
        )
      )
        throw new TaskConnectionError();
      throw error;
    }
  }
  const found = await admin
    .from("integration_linked_accounts")
    .select("access_token_ciphertext,credential_key_version,updated_at,provider_account_id")
    .eq("id", grant.connection_ref)
    .eq("owner_id", grant.user_id)
    .eq("provider_id", grant.provider)
    .eq("status", "connected")
    .is("deleted_at", null)
    .maybeSingle()
    .abortSignal(signal);
  const row = object(found.data);
  if (
    found.error ||
    typeof row.access_token_ciphertext !== "string" ||
    row.provider_account_id !== grant.provider_account_id ||
    `${row.credential_key_version}:${Date.parse(string(row.updated_at))}` !==
      grant.connection_generation
  )
    throw new TaskConnectionError();
  const token = await decryptCredential(row.access_token_ciphertext);
  const profile = await json(
    grant.provider === "slack" ? "https://slack.com/api/auth.test" : "https://api.github.com/user",
    token,
    signal,
    grant,
  );
  const subject =
    grant.provider === "slack"
      ? `${string(profile.team_id)}:${string(profile.user_id)}`
      : String(profile.id ?? "");
  if (subject !== grant.provider_account_id || (grant.provider === "slack" && profile.ok !== true))
    throw new TaskConnectionError();
  await assertTaskConnectionCurrent(grant, signal);
  return token;
}
export async function readTaskConnectedContext(
  grant: TaskConnectionGrant,
  resource: string,
  signal: AbortSignal,
): Promise<string> {
  resource = taskResource(grant.provider, resource);
  const token = await currentTaskConnectionToken(grant, signal);
  if (grant.provider === "gmail") {
    const value = await json(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${resource}?format=full`,
      token,
      signal,
      grant,
    );
    if (value.id !== resource) throw new TaskConnectionError();
    const payload = object(value.payload),
      headers = Array.isArray(payload.headers) ? payload.headers.map(object) : [];
    const fields = headers
      .filter((header) =>
        ["from", "to", "subject", "date"].includes(string(header.name).toLowerCase()),
      )
      .map((header) => `${string(header.name, 30)}: ${string(header.value, 1000)}`);
    let text = "";
    let visited = 0;
    const visit = (part: Record<string, unknown>) => {
      if (++visited > 40) return;
      if (part.mimeType === "text/plain" && typeof object(part.body).data === "string")
        text += Buffer.from(string(object(part.body).data, 16000), "base64url")
          .toString("utf8")
          .slice(0, 12000 - text.length);
      if (Array.isArray(part.parts))
        for (const child of part.parts.slice(0, 20)) visit(object(child));
    };
    visit(payload);
    return [...fields, text || string(value.snippet)].join("\n").slice(0, 12000);
  }
  if (grant.provider === "slack") {
    const info = await json(
      `https://slack.com/api/conversations.info?channel=${resource}`,
      token,
      signal,
      grant,
    );
    const channel = object(info.channel);
    if (
      info.ok !== true ||
      channel.id !== resource ||
      typeof channel.is_private !== "boolean" ||
      (channel.is_private &&
        (!grant.required_scopes.includes("groups:history") ||
          !grant.required_scopes.includes("groups:read")))
    )
      throw new TaskConnectionError();
    const value = await json(
      `https://slack.com/api/conversations.history?channel=${resource}&limit=15`,
      token,
      signal,
      grant,
    );
    if (value.ok !== true || !Array.isArray(value.messages)) throw new TaskConnectionError();
    return value.messages
      .slice(0, 15)
      .map((item) => {
        const msg = object(item);
        return `${string(msg.user, 80)}: ${string(msg.text, 2000)}`;
      })
      .join("\n")
      .slice(0, 12000);
  }
  const [owner, repo, pull] = resource.split("/");
  const value = await json(
    `https://api.github.com/repos/${owner}/${repo}${pull ? `/pulls/${pull}` : ""}`,
    token,
    signal,
    grant,
  );
  if (pull) {
    if (Number(value.number) !== Number(pull)) throw new TaskConnectionError();
    return JSON.stringify({
      number: value.number,
      title: string(value.title, 1000),
      body: string(value.body, 9000),
      state: value.state,
      author: object(value.user).login,
      merged: value.merged,
    }).slice(0, 12000);
  }
  if (string(value.full_name).toLowerCase() !== `${owner}/${repo}`.toLowerCase())
    throw new TaskConnectionError();
  return JSON.stringify({
    repository: value.full_name,
    description: string(value.description),
    defaultBranch: value.default_branch,
    openIssues: value.open_issues_count,
    updatedAt: value.updated_at,
  }).slice(0, 12000);
}
export async function listTaskConnectedResourceOptions(
  grant: TaskConnectionGrant,
  cursor: string | null,
  signal: AbortSignal,
): Promise<{ items: Array<{ id: string; label: string }>; nextCursor: string | null }> {
  const token = await currentTaskConnectionToken(grant, signal);
  if (grant.provider === "gmail") {
    const value = await json(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`,
      token,
      signal,
      grant,
    );
    if (!Array.isArray(value.messages)) return { items: [], nextCursor: null };
    const items = [];
    for (const item of value.messages.slice(0, 10)) {
      const id = taskResource("gmail", object(item).id);
      const message = await json(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        token,
        signal,
        grant,
      );
      const headers = object(message.payload).headers;
      const title = Array.isArray(headers)
        ? headers
            .map(object)
            .filter((header) => ["subject", "from"].includes(string(header.name).toLowerCase()))
            .map((header) => string(header.value, 200))
            .join(" · ")
        : "";
      items.push({ id, label: title || "Message without a subject" });
    }
    return {
      items,
      nextCursor: typeof value.nextPageToken === "string" ? value.nextPageToken : null,
    };
  }
  if (grant.provider === "slack") {
    const value = await json(
      `https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      token,
      signal,
      grant,
    );
    if (value.ok !== true || !Array.isArray(value.channels)) throw new TaskConnectionError();
    return {
      items: value.channels
        .map(object)
        .filter((row) => row.is_member === true && row.is_private === false)
        .map((row) => ({ id: taskResource("slack", row.id), label: "#" + string(row.name, 200) })),
      nextCursor: string(object(value.response_metadata).next_cursor, 500) || null,
    };
  }
  const page = cursor ? Number(cursor) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new TaskConnectionError();
  await assertTaskConnectionCurrent(grant, signal);
  const response = await fetch(
    `https://api.github.com/user/repos?per_page=10&sort=updated&page=${page}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal,
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok) throw new TaskConnectionError();
  const { readProviderText } = await import("@/lib/provider-response.server.mjs");
  const value: unknown = JSON.parse(await readProviderText(response, 128000));
  if (!Array.isArray(value)) throw new TaskConnectionError();
  await assertTaskConnectionCurrent(grant, signal);
  return {
    items: value
      .slice(0, 30)
      .map(object)
      .map((row) => ({
        id: taskResource("github", row.full_name),
        label: string(row.full_name, 200),
      })),
    nextCursor: response.headers.get("link")?.includes('rel="next"') ? String(page + 1) : null,
  };
}
