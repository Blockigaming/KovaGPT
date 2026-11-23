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
import { decryptCredential } from "@/integrations/credential-vault.server";
import { canReadConnection, hasConnectionScopes } from "@/integrations/connection-flows.mjs";
import { configuredOAuthProviders } from "@/integrations/oauth-providers.server";
import type { ConnectionDomainDatabase } from "@/integrations/connection-domain.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectorWriteAllowed,
  saveConnectorWritePreference,
} from "@/lib/connector-write-policy.server";

const targetSchema = z.discriminatedUnion("connector", [
  z.object({ connector: z.literal("github"), target: z.string().regex(/^[1-9][0-9]{0,18}$/u) }),
  z.object({ connector: z.literal("gmail"), target: z.string().uuid() }),
  z.object({ connector: z.literal("google-calendar"), target: z.string().uuid() }),
  z.object({ connector: z.literal("onedrive"), target: z.string().uuid() }),
  z.object({ connector: z.literal("outlook"), target: z.string().uuid() }),
  z.object({ connector: z.literal("google-drive"), target: z.string().uuid() }),
  z.object({ connector: z.literal("outlook-calendar"), target: z.string().uuid() }),
]);
const connectorDb = () => supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
const microsoftOperations = {
  onedrive: { scope: "Files.ReadWrite", path: "/me/drive/root/children" },
  outlook: { scope: "Mail.ReadWrite", path: "/me/messages" },
  "outlook-calendar": { scope: "Calendars.ReadWrite", path: "/me/calendar/events" },
} as const;
type MicrosoftWriteConnector = keyof typeof microsoftOperations;
const googleWriteCapability = {
  gmail: "gmail.write",
  "google-calendar": "calendar.write",
  "google-drive": "drive.write",
} as const;
const microsoftAccount = async (owner: string, id: string, connector: MicrosoftWriteConnector) => {
  const { data, error } = await connectorDb()
    .from("integration_linked_accounts")
    .select(
      "id,provider_id,status,granted_scopes,token_expires_at,deleted_at,access_token_ciphertext,updated_at",
    )
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("provider_id", "microsoft")
    .is("workspace_id", null)
    .is("deleted_at", null)
    .maybeSingle();
  return !error &&
    data &&
    canReadConnection({ ...data, account_label: null }, connector) &&
    hasConnectionScopes(data.granted_scopes, [microsoftOperations[connector].scope])
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
        connector === "outlook-calendar"
      ) {
        if (!(await microsoftAccount(userId, target, connector)))
          return { error: "Authorize write access with Microsoft first." };
      } else {
        const account = await getGoogleConnection(userId, target);
        if (!account || !hasGoogleCapability(account.scopes, googleWriteCapability[connector]))
          return { error: "Authorize write access with Google first." };
      }
    }
    await saveConnectorWritePreference(userId, connector, target, enabled);
    return { enabled };
  });

async function microsoftWrite(
  userId: string,
  target: string,
  connector: MicrosoftWriteConnector,
  body: Record<string, unknown>,
) {
  await limitWrites(userId);
  if (!configuredOAuthProviders().some((provider) => provider.id === "microsoft"))
    return { error: "Microsoft connection setup is unavailable." };
  const account = await microsoftAccount(userId, target, connector);
  if (!account) return { error: "Microsoft write permission is missing or expired." };
  const token = await decryptCredential(account.access_token_ciphertext);
  const current = await microsoftAccount(userId, target, connector);
  await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
  if (
    !current ||
    current.updated_at !== account.updated_at ||
    current.access_token_ciphertext !== account.access_token_ciphertext ||
    !(await connectorWriteAllowed(userId, connector, target))
  )
    return { error: "Write access changed. Review the account permissions." };
  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0${microsoftOperations[connector].path}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    await response.body?.cancel().catch(() => {});
    if (response.status === 201) return { created: true };
    if (connector === "onedrive" && response.status === 409)
      return { error: "An item with that name already exists in OneDrive." };
    return { error: "Microsoft did not confirm the write. Check the provider before retrying." };
  } catch {
    return { error: "The write could not be confirmed. Check the provider before retrying." };
  }
}

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

export const createOutlookDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      target: z.string().uuid(),
      recipient: z.string().trim().max(254).email(),
      subject: z.string().trim().min(1).max(120),
      body: z.string().max(4000),
    }),
  )
  .handler(({ context, data }) =>
    microsoftWrite(context.userId, data.target, "outlook", {
      subject: data.subject,
      body: { contentType: "Text", content: data.body },
      toRecipients: [{ emailAddress: { address: data.recipient } }],
    }),
  );
