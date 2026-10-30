import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertLockdownAllows } from "./lockdown-policy.mjs";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { decryptSecret } from "./github-oauth.server";
import { createGitHubChatTools } from "./github-chat-read.server.mjs";

export const githubChatTools = createGitHubChatTools({
  db: supabaseAdmin,
  guard: (ownerId) => assertLockdownAllows(supabaseAdmin, ownerId, "connector_read"),
  rate: async (ownerId) => {
    const result = await consumeApplicationRateLimit({
      identity: `user:${ownerId}`,
      action: "connection_read",
      limit: 30,
      windowSeconds: 60,
    });
    return result.allowed;
  },
  decrypt: decryptSecret,
  configured: () =>
    Boolean(
      process.env.GITHUB_OAUTH_CLIENT_ID &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET &&
      process.env.CONNECTOR_ENCRYPTION_KEY &&
      Buffer.from(process.env.CONNECTOR_ENCRYPTION_KEY, "base64").length === 32,
    ),
});
