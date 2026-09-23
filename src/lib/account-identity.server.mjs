import { resolveKovaAuthMode } from "./kova-auth-contract.mjs";

// Internal directory lookup, never a session authenticator. Callers must first
// authenticate their browser/service request and derive the requested UUID.
export async function readAccountIdentity(client, accountId, requireVerified = true) {
  if (
    typeof accountId !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(accountId)
  )
    return null;
  const mode = resolveKovaAuthMode();
  let value;
  if (mode === "supabase") {
    const result = await client.auth.admin.getUserById(accountId);
    if (result.error) throw new Error("account_identity_unavailable");
    value = result.data.user ?? null;
  } else {
    const result = await client.rpc("kova_auth_account_snapshot", {
      p_account_id: accountId,
      p_allow_legacy: mode === "dual",
      p_require_verified: requireVerified,
    });
    if (result.error) throw new Error("account_identity_unavailable");
    value = result.data;
  }
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("account_identity_invalid");
  if (
    value.id !== accountId ||
    typeof value.email !== "string" ||
    value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/u.test(value.email) ||
    /@auth\.invalid\.kovagpt\.com$/iu.test(value.email)
  ) {
    throw new Error("account_identity_invalid");
  }
  if (value.deleted_at || value.is_anonymous === true) return null;
  if (
    value.banned_until != null &&
    (typeof value.banned_until !== "string" ||
      !Number.isFinite(Date.parse(value.banned_until)) ||
      Date.parse(value.banned_until) > Date.now())
  )
    return null;
  const dateOrNull = (at) =>
    typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
  const verified = dateOrNull(value.email_confirmed_at);
  if (requireVerified && !verified) return null;
  const provider = mode === "supabase" ? "supabase" : value.app_metadata?.provider;
  if (!["kova", "supabase"].includes(provider) || (mode === "kova" && provider !== "kova")) {
    throw new Error("account_identity_invalid");
  }
  // No password, provider token, raw app metadata or private auth state can enter
  // an account export, even when an upstream response gains additional fields.
  return {
    id: accountId,
    email: value.email,
    email_confirmed_at: verified,
    created_at: dateOrNull(value.created_at),
    updated_at: dateOrNull(value.updated_at),
    app_metadata: { provider },
    user_metadata: {
      full_name:
        typeof value.user_metadata?.full_name === "string"
          ? value.user_metadata.full_name.slice(0, 120)
          : null,
    },
  };
}
