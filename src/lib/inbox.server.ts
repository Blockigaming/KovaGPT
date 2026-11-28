import { z } from "zod";
import { Buffer } from "node:buffer";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadConnection, hasConnectionScopes } from "@/integrations/connection-flows.mjs";
import {
  renewListedOAuthAccounts,
  type ConnectorDatabase,
} from "@/integrations/connected-tools.server";
import { configuredOAuthProviders } from "@/integrations/oauth-providers.server";
import { decryptCredential } from "@/integrations/credential-vault.server";
import {
  canUsePaidGoogleConnector,
  getGoogleAccountsHealth,
  getGoogleExecutionBinding,
  getValidGoogleAccessToken,
} from "@/lib/google-oauth.server";
import { connectorWriteAllowed } from "@/lib/connector-write-policy.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import type { InboxAccount, InboxMessage, InboxPage } from "@/lib/inbox-model";

const gmail = "https://gmail.googleapis.com/gmail/v1/users/me";
const graph = "https://graph.microsoft.com/v1.0/me";
const db = () => supabaseAdmin as unknown as SupabaseClient<ConnectorDatabase>;

function checkOwner(expected: string, actual: string) {
  if (expected !== actual) throw new Error("Account changed. Reopen Inbox.");
}

async function protect(owner: string, write = false) {
  await assertLockdownAllows(supabaseAdmin, owner, write ? "connector_write" : "connector_read");
  const result = await consumeApplicationRateLimit({
    identity: `user:${owner}`,
    action: write ? "inbox_write" : "inbox_read",
    limit: write ? 16 : 40,
    windowSeconds: 60,
  });
  if (!result.allowed) throw new Error("Inbox is temporarily unavailable. Try again shortly.");
}

async function outlookAccounts(owner: string) {
  const configured = new Set(configuredOAuthProviders().map(({ id }) => id));
  if (!configured.has("microsoft")) return [];
  const { data, error } = await db()
    .from("integration_linked_accounts")
    .select("id,provider_id,account_label,status,granted_scopes,token_expires_at,updated_at")
    .eq("owner_id", owner)
    .eq("provider_id", "microsoft")
    .eq("status", "connected")
    .is("workspace_id", null)
    .is("deleted_at", null)
    .limit(30);
  if (error) throw new Error("Outlook connection status is unavailable.");
  return (await renewListedOAuthAccounts(owner, data ?? [], configured)).filter((account) =>
    canReadConnection(account, "outlook"),
  );
}

export async function listInboxAccountsServer(
  data: { owner: string },
  context: { userId: string },
): Promise<InboxAccount[]> {
  checkOwner(data.owner, context.userId);
  await protect(context.userId);
  const owner = context.userId;
  const [google, outlook] = await Promise.allSettled([
    canUsePaidGoogleConnector(owner).then((allowed) =>
      allowed ? getGoogleAccountsHealth(owner) : null,
    ),
    outlookAccounts(owner),
  ]);
  const accounts: InboxAccount[] = [];
  if (google.status === "fulfilled" && google.value) {
    for (const account of google.value.accounts) {
      if (!account.id || !account.connected || !account.has.gmail) continue;
      const enabled = await connectorWriteAllowed(owner, "gmail", account.id);
      accounts.push({
        id: account.id,
        provider: "gmail",
        label: account.email || "Gmail",
        canModify:
          enabled && account.scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
        canReply: enabled && account.has.gmailWrite,
      });
    }
  }
  if (outlook.status === "fulfilled") {
    for (const account of outlook.value) {
      const enabled = await connectorWriteAllowed(owner, "outlook", account.id);
      accounts.push({
        id: account.id,
        provider: "outlook",
        label: account.account_label || "Outlook",
        canModify: enabled && hasConnectionScopes(account.granted_scopes, ["Mail.ReadWrite"]),
        canReply: enabled && hasConnectionScopes(account.granted_scopes, ["Mail.Send"]),
      });
    }
  }
  if (!accounts.length && (google.status === "rejected" || outlook.status === "rejected"))
    throw new Error("Mail connection status could not be verified.");
  return accounts;
}

type Operation = "read" | "modify" | "reply";
type Target = { owner: string; account: string; provider: "gmail" | "outlook" };
async function access(target: Target, operation: Operation) {
  const { owner, account, provider } = target;
  const write = operation !== "read";
  await protect(owner, write);
  if (write && !(await connectorWriteAllowed(owner, provider, account)))
    throw new Error("Enable write access for this account in Connections.");
  if (provider === "gmail") {
    const binding = await getGoogleExecutionBinding(owner, account);
    if (!binding.grantId || binding.connectionId !== account) throw new Error("Reconnect Gmail.");
    const capability =
      operation === "modify"
        ? "gmail.modify"
        : operation === "reply"
          ? "gmail.write"
          : "gmail.read";
    const token = await getValidGoogleAccessToken(owner, { ...binding, capability });
    return {
      token,
      verify: async () => {
        const current = await getGoogleExecutionBinding(owner, account);
        await assertLockdownAllows(
          supabaseAdmin,
          owner,
          write ? "connector_write" : "connector_read",
        );
        if (
          current.grantId !== binding.grantId ||
          current.connectionId !== account ||
          current.expectedGoogleSub !== binding.expectedGoogleSub ||
          (write && !(await connectorWriteAllowed(owner, provider, account)))
        )
          throw new Error("Mail permissions changed. Reopen Inbox.");
      },
    };
  }
  const configured = () => configuredOAuthProviders().some(({ id }) => id === "microsoft");
  const lookup = () =>
    db()
      .from("integration_linked_accounts")
      .select(
        "id,provider_id,account_label,status,granted_scopes,token_expires_at,updated_at,access_token_ciphertext,deleted_at",
      )
      .eq("owner_id", owner)
      .eq("id", account)
      .eq("provider_id", "microsoft")
      .is("workspace_id", null)
      .is("deleted_at", null)
      .maybeSingle();
  const { data: row, error } = await lookup();
  const scope =
    operation === "modify" ? "Mail.ReadWrite" : operation === "reply" ? "Mail.Send" : "Mail.Read";
  if (
    error ||
    !row ||
    !configured() ||
    !canReadConnection(row, "outlook") ||
    !hasConnectionScopes(row.granted_scopes, [scope])
  )
    throw new Error("Reconnect Outlook or grant the required mail permission.");
  const token = await decryptCredential(row.access_token_ciphertext);
  return {
    token,
    verify: async () => {
      const { data: current, error: currentError } = await lookup();
      await assertLockdownAllows(
        supabaseAdmin,
        owner,
        write ? "connector_write" : "connector_read",
      );
      if (
        currentError ||
        !current ||
        !configured() ||
        !canReadConnection(current, "outlook") ||
        !hasConnectionScopes(current.granted_scopes, [scope]) ||
        current.updated_at !== row.updated_at ||
        current.access_token_ciphertext !== row.access_token_ciphertext ||
        (write && !(await connectorWriteAllowed(owner, provider, account)))
      )
        throw new Error("Mail permissions changed. Reopen Inbox.");
    },
  };
}

type Access = Awaited<ReturnType<typeof access>>;
async function request(auth: Access, url: string, method = "GET", body?: object) {
  await auth.verify();
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.body-content-type="text"',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      "Mail provider did not confirm the request. Check your account before retrying.",
    );
  }
  return response;
}

async function json(auth: Access, url: string, method = "GET", body?: object) {
  return readProviderJsonObject(await request(auth, url, method, body), 4 * 1024 * 1024);
}

type GmailPart = {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailRecord = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
function header(message: GmailRecord, name: string) {
  return message.payload?.headers?.find((item) => item.name?.toLowerCase() === name)?.value || "";
}
function plain(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8").slice(0, 100_000);
  for (const child of part.parts ?? []) {
    const text = plain(child);
    if (text) return text;
  }
  return "";
}
function gmailMessage(message: GmailRecord, detail = false): InboxMessage {
  return {
    id: message.id || "",
    from: header(message, "from").slice(0, 512),
    subject: header(message, "subject").slice(0, 1000) || "(No subject)",
    preview: (message.snippet || "").slice(0, 500),
    date: new Date(Number(message.internalDate) || 0).toISOString(),
    unread: Boolean(message.labelIds?.includes("UNREAD")),
    ...(detail ? { body: plain(message.payload) || message.snippet || "" } : {}),
  };
}
type GraphRecord = {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  body?: { contentType?: string; content?: string };
};
function graphMessage(message: GraphRecord, detail = false): InboxMessage {
  return {
    id: message.id || "",
    from: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "",
    subject: message.subject || "(No subject)",
    preview: message.bodyPreview || "",
    date: message.receivedDateTime || "",
    unread: message.isRead === false,
    ...(detail
      ? {
          body:
            message.body?.contentType?.toLowerCase() === "text"
              ? (message.body.content || "").slice(0, 100_000)
              : message.bodyPreview || "",
        }
      : {}),
  };
}
const graphFields = "id,subject,from,bodyPreview,receivedDateTime,isRead";

export async function listInboxMessagesServer(
  data: Target & { folder: "inbox" | "trash"; cursor: string | null },
  context: { userId: string },
): Promise<InboxPage> {
  checkOwner(data.owner, context.userId);
  const auth = await access(data, "read");
  if (data.provider === "gmail") {
    const params = new URLSearchParams({
      labelIds: data.folder === "inbox" ? "INBOX" : "TRASH",
      maxResults: "20",
      includeSpamTrash: String(data.folder === "trash"),
    });
    if (data.cursor) params.set("pageToken", data.cursor);
    const result = (await json(auth, `${gmail}/messages?${params}`)) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    const messages: InboxMessage[] = [];
    const ids = (result.messages ?? []).slice(0, 20);
    for (let i = 0; i < ids.length; i += 5) {
      const batch = await Promise.all(
        ids
          .slice(i, i + 5)
          .map(async ({ id }) =>
            gmailMessage(
              (await json(
                auth,
                `${gmail}/messages/${encodeURIComponent(id)}?format=metadata`,
              )) as GmailRecord,
            ),
          ),
      );
      messages.push(...batch);
    }
    return { messages: messages.filter((item) => item.id), next: result.nextPageToken ?? null };
  }
  const folder = data.folder === "inbox" ? "inbox" : "deleteditems";
  const url = new URL(`${graph}/mailFolders/${folder}/messages`);
  url.searchParams.set("$select", graphFields);
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set("$top", "20");
  if (data.cursor) {
    if (!/^\d{1,8}$/u.test(data.cursor)) throw new Error("Invalid Inbox cursor.");
    url.searchParams.set("$skip", data.cursor);
  }
  const result = (await json(auth, url.href)) as {
    value?: GraphRecord[];
    "@odata.nextLink"?: string;
  };
  const next = result["@odata.nextLink"];
  let cursor: string | null = null;
  if (next) {
    const parsed = new URL(next);
    const skip = parsed.searchParams.get("$skip");
    if (parsed.origin === "https://graph.microsoft.com" && skip && /^\d{1,8}$/u.test(skip))
      cursor = skip;
  }
  return {
    messages: (result.value ?? []).map((item) => graphMessage(item)).filter((item) => item.id),
    next: cursor,
  };
}

export async function readInboxMessageServer(
  data: Target & { id: string },
  context: { userId: string },
): Promise<InboxMessage> {
  checkOwner(data.owner, context.userId);
  const auth = await access(data, "read");
  const id = encodeURIComponent(data.id);
  return data.provider === "gmail"
    ? gmailMessage((await json(auth, `${gmail}/messages/${id}?format=full`)) as GmailRecord, true)
    : graphMessage(
        (await json(auth, `${graph}/messages/${id}?$select=${graphFields},body`)) as GraphRecord,
        true,
      );
}

export async function updateInboxMessageServer(
  data: Target & { id: string; action: "read" | "unread" | "trash" | "restore"; confirmed: true },
  context: { userId: string },
) {
  checkOwner(data.owner, context.userId);
  const auth = await access(data, "modify");
  const id = encodeURIComponent(data.id);
  const base = data.provider === "gmail" ? gmail : graph;
  const url = `${base}/messages/${id}`;
  let response: Response;
  if (data.provider === "gmail") {
    response =
      data.action === "trash" || data.action === "restore"
        ? await request(auth, `${url}/${data.action === "trash" ? "trash" : "untrash"}`, "POST")
        : await request(
            auth,
            `${url}/modify`,
            "POST",
            data.action === "read" ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
          );
  } else {
    response =
      data.action === "trash" || data.action === "restore"
        ? await request(auth, `${url}/move`, "POST", {
            destinationId: data.action === "trash" ? "deleteditems" : "inbox",
          })
        : await request(auth, url, "PATCH", { isRead: data.action === "read" });
  }
  await response.body?.cancel().catch(() => {});
  return { ok: true };
}

export async function replyInboxMessageServer(
  data: Target & { id: string; body: string; confirmed: true },
  context: { userId: string },
) {
  checkOwner(data.owner, context.userId);
  const auth = await access(data, "reply");
  const id = encodeURIComponent(data.id);
  if (data.provider === "outlook") {
    const response = await request(auth, `${graph}/messages/${id}/reply`, "POST", {
      comment: data.body,
    });
    if (response.status !== 202) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Outlook did not confirm sending. Check the provider before retrying.");
    }
    await response.body?.cancel().catch(() => {});
    return { sent: true };
  }
  // Read the reply destination from this account's original message, never from
  // arbitrary client input. Reject header injection and ambiguous recipients.
  const read = await access(data, "read");
  const message = (await json(read, `${gmail}/messages/${id}?format=metadata`)) as GmailRecord;
  const from = header(message, "reply-to") || header(message, "from");
  const address = (from.match(/<([^<>]+)>$/u)?.[1] || from).trim();
  const messageId = header(message, "message-id");
  const subject = header(message, "subject");
  if (
    /[\r\n]/u.test(from + messageId + subject) ||
    !z.string().email().safeParse(address).success ||
    !/^<[^<>\s]+>$/u.test(messageId) ||
    !message.threadId
  )
    throw new Error("This email has an unsupported reply address or thread. Reply in Gmail.");
  const replySubject = /^re:/iu.test(subject) ? subject : `Re: ${subject}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(replySubject).toString("base64")}?=`;
  const raw = Buffer.from(
    [
      `To: ${address}`,
      `Subject: ${encodedSubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(data.body)
        .toString("base64")
        .match(/.{1,76}/gu)
        ?.join("\r\n") || "",
    ].join("\r\n"),
  ).toString("base64url");
  const result = await json(auth, `${gmail}/messages/send`, "POST", {
    raw,
    threadId: message.threadId,
  });
  if (typeof result.id !== "string" || !result.id)
    throw new Error("Gmail did not confirm sending. Check the provider before retrying.");
  return { sent: true };
}
