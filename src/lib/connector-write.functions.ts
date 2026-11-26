import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getGoogleConnection,
  getGoogleExecutionBinding,
  getValidGoogleAccessToken,
} from "@/lib/google-oauth.server";
import { hasGoogleCapability } from "@/lib/google-account-policy.mjs";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import { decryptCredential } from "@/integrations/credential-vault.server";
import {
  canReadConnection,
  CONNECTION_FLOWS,
  hasConnectionScopes,
} from "@/integrations/connection-flows.mjs";
import {
  configuredKeyProviders,
  configuredOAuthProviders,
} from "@/integrations/oauth-providers.server";
import { unpackKeyCredential } from "@/integrations/key-connection-credential.server.mjs";
import {
  getWixAccessToken,
  webullSignedHeaders,
} from "@/integrations/account-provider-read.server.mjs";
import {
  runReviewedMcpWrite,
  runTanaProposal,
  tanaProposalSchema,
} from "@/integrations/mcp-provider-read.server.mjs";
import { unpackSalesforceCredential } from "@/integrations/salesforce-credential.server.mjs";
import type { ConnectionDomainDatabase } from "@/integrations/connection-domain.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectorWriteAllowed,
  saveConnectorWritePreference,
} from "@/lib/connector-write-policy.server";
import {
  EXTRA_WRITE_ACTIONS,
  EXTRA_WRITE_CONNECTORS,
  isExtraWriteConnector,
  type ExtraWriteConnector,
} from "@/lib/connector-write-actions";
import {
  connectorWriteFieldsValid,
  connectorWriteRequest,
} from "@/lib/connector-write-requests.server";

const targetSchema = z
  .object({
    connector: z.enum([
      "github",
      "linear",
      "gmail",
      "google-calendar",
      "onedrive",
      "outlook",
      "google-drive",
      "outlook-calendar",
      ...EXTRA_WRITE_CONNECTORS,
    ]),
    target: z.string(),
  })
  .refine(
    ({ connector, target }) =>
      connector === "github"
        ? /^[1-9][0-9]{0,18}$/u.test(target)
        : z.string().uuid().safeParse(target).success,
    { path: ["target"], message: "Invalid connection target." },
  );
const connectorDb = () => supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
const microsoftOperations = {
  onedrive: { scope: "Files.ReadWrite", path: "/me/drive/root/children", status: 201 },
  outlook: { scope: "Mail.ReadWrite", path: "/me/messages", status: 201 },
  "outlook-send": { scope: "Mail.Send", path: "/me/sendMail", status: 202 },
  "outlook-calendar": { scope: "Calendars.ReadWrite", path: "/me/calendar/events", status: 201 },
} as const;
type MicrosoftWriteConnector = keyof typeof microsoftOperations;
type LinkedWriteConnector = MicrosoftWriteConnector | "linear" | ExtraWriteConnector;
const linearIssueResult = z.object({
  errors: z.array(z.unknown()).max(0).optional(),
  data: z.object({
    issueCreate: z.object({ success: z.literal(true), issue: z.object({ id: z.string().uuid() }) }),
  }),
});
const googleWriteCapability = {
  gmail: "gmail.write",
  "google-calendar": "calendar.write",
  "google-drive": "drive.write",
} as const;

function linkedGrant(connector: LinkedWriteConnector) {
  const extra = isExtraWriteConnector(connector) ? EXTRA_WRITE_ACTIONS[connector] : undefined;
  const preference = connector === "outlook-send" ? "outlook" : connector;
  const readConnection = extra?.readConnection ?? preference;
  const provider = CONNECTION_FLOWS[readConnection].provider;
  const scope = extra
    ? extra.scope
    : connector === "linear"
      ? "issues:create"
      : microsoftOperations[connector as MicrosoftWriteConnector].scope;
  const label = provider === "microsoft" ? "Microsoft" : CONNECTION_FLOWS[readConnection].label;
  return { provider, scope, label, readConnection, preference };
}

const linkedWriteAccount = async (owner: string, id: string, connector: LinkedWriteConnector) => {
  const { provider, scope, readConnection } = linkedGrant(connector);
  const { data, error } = await connectorDb()
    .from("integration_linked_accounts")
    .select(
      "id,provider_id,status,granted_scopes,token_expires_at,deleted_at,access_token_ciphertext,updated_at",
    )
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("provider_id", provider)
    .is("workspace_id", null)
    .is("deleted_at", null)
    .maybeSingle();
  return !error &&
    data &&
    canReadConnection({ ...data, account_label: null }, readConnection) &&
    (!scope || hasConnectionScopes(data.granted_scopes, [scope]))
    ? data
    : null;
};

export const getConnectorWriteAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(targetSchema)
  .handler(async ({ context, data }) => ({
    enabled: await connectorWriteAllowed(context.userId, data.connector, data.target),
  }));

async function limitWrites(owner: string) {
  const limit = await consumeApplicationRateLimit({
    identity: `user:${owner}`,
    action: "connector_write_settings",
    limit: 16,
    windowSeconds: 60,
  });
  if (!limit.allowed) throw new Error("Connector changes are temporarily unavailable.");
}

export const setConnectorWriteAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ subject: targetSchema, enabled: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const {
      subject: { connector, target },
      enabled,
    } = data;
    await limitWrites(userId);
    if (enabled) {
      await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
      if (connector === "github") {
        // Generated GitHub table types are owned by the migration pipeline.
        const { data: repo, error } = await supabaseAdmin
          .from("github_repositories" as never)
          .select("permissions,archived")
          .eq("owner_id", userId)
          .eq("id", target)
          .eq("explicitly_granted", true)
          .is("revoked_at", null)
          .maybeSingle();
        const row = repo as {
          permissions?: { push?: boolean; admin?: boolean };
          archived?: boolean;
        } | null;
        if (error || !row || row.archived || (!row.permissions?.push && !row.permissions?.admin))
          return { error: "GitHub must grant write access to this repository first." };
      } else if (
        connector === "onedrive" ||
        connector === "outlook" ||
        connector === "outlook-calendar" ||
        connector === "linear" ||
        isExtraWriteConnector(connector)
      ) {
        if (!(await linkedWriteAccount(userId, target, connector)))
          return {
            error: `Authorize write access with ${linkedGrant(connector).label} first.`,
          };
      } else {
        const account = await getGoogleConnection(userId, target);
        if (!account || !hasGoogleCapability(account.scopes, googleWriteCapability[connector]))
          return { error: "Authorize write access with Google first." };
      }
    }
    await saveConnectorWritePreference(userId, connector, target, enabled);
    return { enabled };
  });

async function linkedWriteToken(userId: string, target: string, connector: LinkedWriteConnector) {
  await limitWrites(userId);
  const { provider, label, readConnection, preference } = linkedGrant(connector);
  const providers =
    CONNECTION_FLOWS[readConnection].authentication === "api-key"
      ? configuredKeyProviders()
      : configuredOAuthProviders();
  if (!providers.some(({ id }) => id === provider))
    return { error: `${label} connection setup is unavailable.` };
  await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
  const account = await linkedWriteAccount(userId, target, connector);
  if (!account) return { error: `${label} write permission is missing or expired.` };
  const token = await decryptCredential(account.access_token_ciphertext);
  const stillAuthorized = async () => {
    const current = await linkedWriteAccount(userId, target, connector);
    await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
    return Boolean(
      current &&
      current.updated_at === account.updated_at &&
      current.access_token_ciphertext === account.access_token_ciphertext &&
      (await connectorWriteAllowed(userId, preference, target)),
    );
  };
  if (!(await stillAuthorized()))
    return { error: "Write access changed. Review the account permissions." };
  return { token, stillAuthorized };
}

async function assertLinkedWriteAccess(stillAuthorized: () => Promise<boolean>) {
  if (!(await stillAuthorized())) throw new Error("connection_permission_required");
}

export const loadTanaProposalSchema = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ target: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const access = await linkedWriteToken(context.userId, data.target, "tana");
    if (!access.token) return { error: access.error };
    try {
      return {
        schema: await tanaProposalSchema(access.token, fetch, () =>
          assertLinkedWriteAccess(access.stillAuthorized),
        ),
      };
    } catch {
      return { error: "Could not load the document request fields from Tana." };
    }
  });

export const runConnectorWriteAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        connector: z.enum(EXTRA_WRITE_CONNECTORS),
        target: z.string().uuid(),
        confirmed: z.literal(true),
        fields: z.record(z.string(), z.string().trim().max(2000)),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    const { connector, target, fields } = data;
    if (!connectorWriteFieldsValid(connector, fields))
      return { error: "Review the action fields and try again." };
    const access = await linkedWriteToken(context.userId, target, connector);
    if (!access.token) return { error: access.error };
    const { label } = linkedGrant(connector);
    try {
      if (connector === "custom-mcp") {
        const accepted = await runReviewedMcpWrite(
          access.token,
          fields.operation,
          fields.text,
          () => assertLinkedWriteAccess(access.stillAuthorized),
        );
        if (accepted) return { ok: true as const };
        return {
          error: "The MCP server did not confirm the change. Check the server before retrying.",
        };
      }
      if (connector === "tana") {
        const reference = await runTanaProposal(access.token, fields.argumentsJson, fetch, () =>
          assertLinkedWriteAccess(access.stillAuthorized),
        );
        if (reference) return { ok: true as const, reference };
        return { error: "Tana did not confirm the proposal session. Check Tana before retrying." };
      }
      const notion =
        connector === "notion-private" ? unpackKeyCredential(connector, access.token) : null;
      const salesforce =
        connector === "salesforce" ? unpackSalesforceCredential(access.token) : null;
      const vercel = connector === "vercel" ? unpackKeyCredential(connector, access.token) : null;
      const mixpanel =
        connector === "mixpanel" ? unpackKeyCredential(connector, access.token) : null;
      const webull = connector === "webull" ? unpackKeyCredential(connector, access.token) : null;
      const request = connectorWriteRequest(connector, fields, {
        notionPageId: notion?.pageId,
        salesforceQuery: salesforce?.query_url,
        vercelTeamId: vercel?.teamId,
        mixpanel: mixpanel ?? undefined,
        webullEnvironment: webull?.environment,
      });
      if (!request) return { error: "Review the action fields and try again." };
      const apiKey = notion?.apiKey ?? salesforce?.access_token ?? vercel?.apiKey ?? access.token;
      const payload = request.body;
      const formEncoded = payload instanceof URLSearchParams;
      const body = formEncoded ? payload.toString() : JSON.stringify(payload);
      let credentials: Record<string, string> = request.credentialHeader
        ? { [request.credentialHeader]: apiKey }
        : { Authorization: `Bearer ${apiKey}` };
      if (mixpanel) {
        credentials = {
          Authorization: `Basic ${Buffer.from(`${mixpanel.username}:${mixpanel.apiKey}`).toString("base64")}`,
        };
      } else if (webull) {
        if (!webull.accessToken)
          return { error: "Link an authorized Webull access token for watchlists first." };
        credentials = webullSignedHeaders(new URL(request.url), webull, body);
      } else if (connector === "etoro") {
        const etoro = unpackKeyCredential(connector, access.token);
        credentials = {
          "x-api-key": etoro.apiKey,
          "x-user-key": etoro.userKey,
          "x-request-id": crypto.randomUUID(),
        };
      } else if (connector === "wix") {
        const authorization = await getWixAccessToken(
          unpackKeyCredential(connector, access.token),
          fetch,
          AbortSignal.timeout(10_000),
        );
        if (!(await access.stillAuthorized()))
          return { error: "Write access changed. Review the account permissions." };
        credentials = { Authorization: authorization };
      }
      const response = await fetch(request.url, {
        method: request.method ?? "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          ...credentials,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": formEncoded
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
              }),
          ...request.header,
        },
        body,
      });
      if (response.status === request.status) {
        const result = await readProviderJsonObject(response, 64 * 1024);
        if (request.confirmed(result)) {
          const link = request.outputLink?.(result);
          const reference = request.outputReference?.(result);
          if (reference) return { ok: true as const, reference };
          return link ? { ok: true as const, link } : { ok: true as const };
        }
      } else {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403)
          return { error: `${label} denied this action. Check the provider's write permission.` };
      }
    } catch (error) {
      if (
        connector === "tana" &&
        (error instanceof SyntaxError ||
          (error instanceof Error && error.message === "invalid_tana_proposal"))
      )
        return { error: "Enter a JSON object that matches Tana's document request fields." };
      // The provider may have applied the operation before the connection was interrupted.
    }
    return { error: `${label} did not confirm the change. Check the provider before retrying.` };
  });

async function microsoftWrite(
  userId: string,
  target: string,
  connector: MicrosoftWriteConnector,
  body: Record<string, unknown>,
) {
  const access = await linkedWriteToken(userId, target, connector);
  if (!access.token) return { error: access.error };
  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0${microsoftOperations[connector].path}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    await response.body?.cancel().catch(() => {});
    if (response.status === microsoftOperations[connector].status) return { created: true };
    if (connector === "onedrive" && response.status === 409)
      return { error: "An item with that name already exists in OneDrive." };
    return { error: "Microsoft did not confirm the write. Check the provider before retrying." };
  } catch {
    return { error: "The write could not be confirmed. Check the provider before retrying." };
  }
}

export const createLinearIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      target: z.string().uuid(),
      teamId: z.string().trim().uuid(),
      title: z.string().trim().min(1).max(120),
      description: z.string().max(4000),
      confirmed: z.literal(true),
    }),
  )
  .handler(async ({ context, data }) => {
    const access = await linkedWriteToken(context.userId, data.target, "linear");
    if (!access.token) return { error: access.error };
    try {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id } } }",
          variables: {
            input: { teamId: data.teamId, title: data.title, description: data.description },
          },
        }),
      });
      if (response.ok) {
        const result = await readProviderJsonObject(response, 64 * 1024);
        if (linearIssueResult.safeParse(result).success) return { created: true };
      } else {
        await response.body?.cancel().catch(() => {});
      }
    } catch {
      // A transport failure can occur after the provider commits the issue.
    }
    return { error: "Linear did not confirm issue creation. Check Linear before retrying." };
  });

export const createOneDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      target: z.string().uuid(),
      name: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .refine(
          (value) =>
            !/[<>:"/\\|?*]/u.test(value) &&
            ![...value].some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ) &&
            !value.endsWith("."),
        ),
    }),
  )
  .handler(({ context, data }) =>
    microsoftWrite(context.userId, data.target, "onedrive", {
      name: data.name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  );

export const createOutlookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        target: z.string().uuid(),
        actionId: z.string().uuid(),
        title: z.string().trim().min(1).max(120),
        start: z.string().datetime(),
        end: z.string().datetime(),
      })
      .refine(
        ({ start, end }) => Date.parse(end) > Date.parse(start),
        "End time must follow start time.",
      ),
  )
  .handler(({ context, data }) =>
    microsoftWrite(context.userId, data.target, "outlook-calendar", {
      subject: data.title,
      start: { dateTime: new Date(data.start).toISOString().slice(0, -1), timeZone: "UTC" },
      end: { dateTime: new Date(data.end).toISOString().slice(0, -1), timeZone: "UTC" },
      transactionId: data.actionId,
    }),
  );

export const createGoogleDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ target: z.string().uuid(), name: z.string().trim().min(1).max(120) }))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    await limitWrites(userId);
    await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
    if (!(await connectorWriteAllowed(userId, "google-drive", data.target)))
      return { error: "Enable Google Drive write access in Connections." };
    const binding = await getGoogleExecutionBinding(userId, data.target);
    const token = await getValidGoogleAccessToken(userId, {
      ...binding,
      capability: "drive.write",
    });
    const current = await getGoogleExecutionBinding(userId, data.target);
    await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
    if (
      binding.connectionId !== data.target ||
      !binding.grantId ||
      current.connectionId !== binding.connectionId ||
      current.grantId !== binding.grantId ||
      current.expectedGoogleSub !== binding.expectedGoogleSub ||
      !(await connectorWriteAllowed(userId, "google-drive", data.target))
    )
      return { error: "Google Drive access changed. Review the account permissions." };
    try {
      const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, mimeType: "application/vnd.google-apps.folder" }),
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return { created: true };
      return {
        error: "Google Drive did not confirm folder creation. Check Drive before retrying.",
      };
    } catch {
      return { error: "Folder creation could not be confirmed. Check Drive before retrying." };
    }
  });

const outlookMessage = z.object({
  target: z.string().uuid(),
  recipient: z.string().trim().max(254).email(),
  subject: z.string().trim().min(1).max(120),
  body: z.string().max(4000),
});

function graphMessage(data: z.infer<typeof outlookMessage>) {
  return {
    subject: data.subject,
    body: { contentType: "Text", content: data.body },
    toRecipients: [{ emailAddress: { address: data.recipient } }],
  };
}

export const createOutlookDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(outlookMessage)
  .handler(({ context, data }) =>
    microsoftWrite(context.userId, data.target, "outlook", graphMessage(data)),
  );

export const sendOutlookMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(outlookMessage.extend({ confirmed: z.literal(true) }).strict())
  .handler(({ context, data }) =>
    microsoftWrite(context.userId, data.target, "outlook-send", { message: graphMessage(data) }),
  );
