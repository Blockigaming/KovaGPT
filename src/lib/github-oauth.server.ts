import { createHash, randomBytes, createPrivateKey, sign } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub tables are available after the Mercury migrations regenerate Supabase types. */

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
async function encryptionKey() {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!secret) throw new Error("CONNECTOR_ENCRYPTION_KEY is required");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      new TextEncoder().encode(value),
    );
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function decryptSecret(value: string) {
  const [iv, data] = value.split(".");
  if (!iv || !data) throw new Error("Invalid encrypted secret");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
    await encryptionKey(),
    Buffer.from(data, "base64url"),
  );
  return new TextDecoder().decode(plain);
}
export async function startGitHubOAuth(ownerId: string, origin: string) {
  await assertLockdownAllows(supabaseAdmin, ownerId, "connector_write");
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID,
    redirect = process.env.GITHUB_REDIRECT_URI || `${origin}/api/github/callback`;
  if (!clientId) throw new Error("GitHub OAuth is not configured");
  const state = b64(randomBytes(32)),
    verifier = b64(randomBytes(48)),
    challenge = b64(createHash("sha256").update(verifier).digest());
  const { error } = await (supabaseAdmin as any).from("github_oauth_states").insert({
    state_hash: createHash("sha256").update(state).digest("hex"),
    owner_id: ownerId,
    code_verifier_ciphertext: await encryptSecret(verifier),
    redirect_uri: redirect,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw error;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", "read:user user:email repo read:org workflow");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
export async function completeGitHubOAuth(code: string, state: string, browserState: string) {
  if (!browserState || browserState !== state) {
    throw new Error("Invalid OAuth browser binding");
  }
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { data, error } = await (supabaseAdmin as any)
    .from("github_oauth_states")
    .select("*")
    .eq("state_hash", stateHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();
  if (error || !data) throw new Error("Invalid or expired OAuth state");
  // Re-check after resolving the state owner. A user can enable Lockdown Mode
  // after starting OAuth but before the provider redirects back.
  await assertLockdownAllows(supabaseAdmin, data.owner_id, "connector_write");
  const claimed = await (supabaseAdmin as any)
    .from("github_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("used_at", null)
    .select("id")
    .single();
  if (claimed.error) throw new Error("OAuth state already used");
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: data.redirect_uri,
      code_verifier: await decryptSecret(data.code_verifier_ciphertext),
    }),
  });
  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !tokens.access_token) throw new Error("GitHub token exchange failed");
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${tokens.access_token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!profileResponse.ok) throw new Error("GitHub profile request failed");
  const profile = (await profileResponse.json()) as {
    id: number;
    login: string;
    avatar_url?: string;
  };
  const account = await (supabaseAdmin as any)
    .from("github_accounts")
    .upsert(
      {
        owner_id: data.owner_id,
        auth_type: "oauth",
        github_user_id: profile.id,
        login: profile.login,
        avatar_url: profile.avatar_url,
        token_ciphertext: await encryptSecret(tokens.access_token),
        refresh_token_ciphertext: tokens.refresh_token
          ? await encryptSecret(tokens.refresh_token)
          : null,
        token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        status: "connected",
        scopes: (tokens.scope ?? "").split(",").filter(Boolean),
        last_health_at: new Date().toISOString(),
        last_refresh_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,auth_type,github_user_id" },
    )
    .select("id,login")
    .single();
  if (account.error) throw account.error;
  return { ownerId: data.owner_id, ...account.data };
}

export async function disconnectAllGitHub(ownerId: string) {
  const { data: accounts, error } = await (supabaseAdmin as any)
    .from("github_accounts")
    .select("id, auth_type, token_ciphertext")
    .eq("owner_id", ownerId);
  if (error) throw new Error("github_account_enumeration_failed");

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const failures: string[] = [];

  for (const account of accounts ?? []) {
    if (
      account.auth_type === "oauth" &&
      account.token_ciphertext &&
      account.token_ciphertext !== "deleted" &&
      clientId &&
      clientSecret
    ) {
      try {
        const token = await decryptSecret(account.token_ciphertext);
        const response = await fetch(
          `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ access_token: token }),
          },
        );
        if (!response.ok) {
          console.error("[account-delete] GitHub grant revocation pending", {
            accountId: account.id,
            status: response.status,
          });
        }
      } catch (error) {
        console.error("[account-delete] GitHub grant revocation pending", {
          accountId: account.id,
          error: error instanceof Error ? error.name : "unknown_error",
        });
      }
    }

    const { data: purgedAccount, error: purgeError } = await (supabaseAdmin as any)
      .from("github_accounts")
      .update({
        status: "revoked",
        token_ciphertext: "deleted",
        refresh_token_ciphertext: null,
        token_expires_at: null,
        scopes: [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id)
      .eq("owner_id", ownerId)
      .select("id")
      .maybeSingle();
    if (purgeError || !purgedAccount) failures.push(account.id);
  }

  if (failures.length) throw new Error("github_account_purge_failed");
  return { disconnected: accounts?.length ?? 0 };
}

export function createGitHubAppJwt(now = Math.floor(Date.now() / 1000)) {
  const appId = process.env.GITHUB_APP_ID,
    key = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !key) throw new Error("GitHub App is not configured");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"),
    header = encode({ alg: "RS256", typ: "JWT" }),
    payload = encode({ iat: now - 60, exp: now + 540, iss: appId }),
    unsigned = `${header}.${payload}`,
    signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(key)).toString(
      "base64url",
    );
  return `${unsigned}.${signature}`;
}
export async function listGitHubAppInstallations() {
  const response = await fetch("https://api.github.com/app/installations", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${createGitHubAppJwt()}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("GitHub installation listing failed");
  return response.json();
}
export async function createInstallationToken(installationId: number) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${createGitHubAppJwt()}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error("GitHub installation token exchange failed");
  return response.json() as Promise<{
    token: string;
    expires_at: string;
    permissions: Record<string, string>;
    repository_selection: string;
  }>;
}
