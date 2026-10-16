// Reviewable dependency selection, NOT a production installer or a replacement
// for release-migrations.json. The full candidate retains canonical history.
export const azureSource = "a3c26832dfda5fe7b5dc88f683411d500b9c5a3e";
export const authSource = "e43686bc123f2e5efcd32a69e843f3fd4bf61b49";
export const coreLifecyclePrelude = Object.freeze([
  "20260903203000_account_data_exports.sql",
  "20260903204500_account_export_deletion_fence.sql",
  "20260904225916_account_export_generation_outbox.sql",
  "20260905001454_organization_administration_foundation.sql",
  "20260905001736_private_auth_identity_helpers.sql",
  "20260905030947_irreversible_account_deletion.sql",
]);
export const privateHelperUsage = "20260925143706_kova_restore_legacy_private_helper_usage.sql";
export const authAdditions = Object.freeze([
  "20260927163950_kova_owned_auth_remaining_review_fixes.sql",
  "20260930224000_kova_owned_storage_cache_boundary.sql",
  "20261001003120_kova_owned_passkey_registration_primary_session.sql",
]);
export function orderedCoreDependencies(migrationNames) {
  return migrationNames
    .filter(
      (name) =>
        coreLifecyclePrelude.includes(name) ||
        name === privateHelperUsage ||
        /_kova_(?:identity_session_store|auth_foreign_key_indexes|owned_.*)\.sql$/u.test(name),
    )
    .sort();
}
export const scope = Object.freeze({
  required: [
    "signup",
    "mail-proof confirmation",
    "login",
    "session revocation",
    "account isolation",
    "guarded account deletion",
  ],
  excluded: ["family creation", "family invite redemption"],
  familyOnlyRpcs: ["create_or_repair_family_group", "accept_family_invite_atomic"],
  sharedNotFamilyOnly: [
    "account_deletion_fences",
    "auth_user_exists",
    "owned directory",
    "existing plan entitlement read",
  ],
  limits:
    "No production reads/writes, hosted jobs, build, deployment, merge or spend. No Auth acceptance inferred from Git source or local tests.",
});
