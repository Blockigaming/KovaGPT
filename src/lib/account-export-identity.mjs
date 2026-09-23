import { resolveKovaAuthMode } from "./kova-auth-contract.mjs";

const shadowEmail = (value) =>
  typeof value === "string" && value.toLowerCase().endsWith("@auth.invalid.kovagpt.com");

export async function readAccountExportIdentity(admin, userId) {
  const mode = resolveKovaAuthMode();
  if (mode !== "supabase") {
    const result = await admin.rpc("kova_auth_export_identity", { p_account_id: userId });
    if (result?.error || !result || !Object.hasOwn(result, "data")) {
      throw new Error("account_export_user_unavailable");
    }
    if (result.data !== null) {
      const row = result.data;
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        row.id !== userId ||
        typeof row.email !== "string" ||
        row.email.length > 320 ||
        !/^[^\s@]+@[^\s@]+$/u.test(row.email) ||
        shadowEmail(row.email) ||
        typeof row.email_confirmed_at !== "string" ||
        !Number.isFinite(Date.parse(row.email_confirmed_at)) ||
        typeof row.created_at !== "string" ||
        !Number.isFinite(Date.parse(row.created_at)) ||
        typeof row.updated_at !== "string" ||
        !Number.isFinite(Date.parse(row.updated_at)) ||
        row.app_metadata?.provider !== "kova" ||
        !Array.isArray(row.identities) ||
        row.identities.length > 16
      ) {
        throw new Error("account_export_user_unavailable");
      }
      const identities = row.identities.map((identity) => {
        if (
          !identity ||
          typeof identity.id !== "string" ||
          !["email", "google"].includes(identity.provider) ||
          typeof identity.identity_data?.email !== "string" ||
          shadowEmail(identity.identity_data.email) ||
          typeof identity.identity_data?.email_verified !== "boolean"
        ) {
          throw new Error("account_export_user_unavailable");
        }
        return {
          id: identity.id,
          provider: identity.provider,
          identity_data: {
            email: identity.identity_data.email,
            email_verified: identity.identity_data.email_verified,
          },
        };
      });
      // Project an explicit allowlist, never unexpected credential fields.
      return {
        id: row.id,
        email: row.email,
        email_confirmed_at: row.email_confirmed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        app_metadata: { provider: "kova", providers: ["kova"] },
        user_metadata: {
          full_name:
            typeof row.user_metadata?.full_name === "string" ? row.user_metadata.full_name : null,
        },
        identities,
      };
    }
    if (mode === "kova") throw new Error("account_export_user_unavailable");
    // Only positively confirmed absence permits dual-mode legacy use.
  }
  const result = await admin.auth.admin.getUserById(userId);
  if (result.error || !result.data?.user) throw new Error("account_export_user_unavailable");
  return projectAccountExportIdentity(admin, userId, result.data.user);
}

export async function projectAccountExportIdentity(admin, userId, user) {
  if (!user || typeof user !== "object" || Array.isArray(user) || user.id !== userId) {
    throw new Error("account_export_user_unavailable");
  }
  if (resolveKovaAuthMode() === "supabase" && !shadowEmail(user.email)) return user;
  const result = await admin.rpc("kova_auth_directory_email", { p_account_id: userId });
  const email = result?.data;
  if (
    result?.error ||
    typeof email !== "string" ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/u.test(email) ||
    shadowEmail(email)
  ) {
    throw new Error("account_export_user_unavailable");
  }
  // Hosted shadow identities are not a second user identity. Preserve genuine
  // provider records, but never export the fabricated compatibility address.
  const identities = Array.isArray(user.identities)
    ? user.identities.filter(
        (identity) => !shadowEmail(identity?.email) && !shadowEmail(identity?.identity_data?.email),
      )
    : user.identities;
  return { ...user, email, ...(identities === undefined ? {} : { identities }) };
}
