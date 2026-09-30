import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MIGRATION_ACL_DETAIL_SQL = readFileSync(
  new URL("./migration-acl-detail.sql", import.meta.url),
  "utf8",
);
export const MIGRATION_ACL_DETAIL_QUERY_SHA256 = createHash("sha256")
  .update(MIGRATION_ACL_DETAIL_SQL)
  .digest("hex");

const ROLES = ["anon", "authenticated", "service_role"];
const validGrant = (grant) =>
  grant &&
  typeof grant.grantor === "string" &&
  typeof grant.grantee === "string" &&
  typeof grant.privilege === "string" &&
  typeof grant.grantable === "boolean";

export function parseMigrationAclDetail(stdout, expectedRelationIds) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > 2 * 1024 * 1024)
    throw new Error("migration_acl_detail_output_invalid");
  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch {
    throw new Error("migration_acl_detail_output_invalid");
  }
  if (
    capture?.transactionReadOnly !== true ||
    capture?.isolationLevel !== "repeatable read" ||
    !Array.isArray(capture?.relations) ||
    !Array.isArray(capture?.defaultPrivileges) ||
    !Array.isArray(expectedRelationIds) ||
    JSON.stringify(capture.relations.map((entry) => entry?.object_id)) !==
      JSON.stringify(expectedRelationIds)
  )
    throw new Error("migration_acl_detail_checkpoint_invalid");

  const defaults = new Set();
  for (const entry of capture.relations) {
    if (
      !["r", "p", "v", "m", "f", "S"].includes(entry?.kind) ||
      !["public.", "kova_private."].some((prefix) => entry.object_id.startsWith(prefix)) ||
      typeof entry.owner_role !== "string" ||
      (entry.raw_acl !== null && typeof entry.raw_acl !== "string") ||
      !Array.isArray(entry.grants) ||
      !entry.grants.every(validGrant) ||
      !Array.isArray(entry.effective) ||
      JSON.stringify(entry.effective.map(({ role }) => role)) !== JSON.stringify(ROLES) ||
      !Array.isArray(entry.column_grants) ||
      entry.column_grants.some(
        (column) =>
          typeof column.name !== "string" ||
          (column.acl !== null && typeof column.acl !== "string"),
      )
    )
      throw new Error("migration_acl_detail_relations_invalid");
  }
  for (const entry of capture.defaultPrivileges) {
    const key = `${entry?.owner_role}:${entry?.schema_name}:${entry?.kind}`;
    if (
      typeof entry?.owner_role !== "string" ||
      (entry.schema_name !== null && typeof entry.schema_name !== "string") ||
      typeof entry.kind !== "string" ||
      (entry.raw_acl !== null && typeof entry.raw_acl !== "string") ||
      !Array.isArray(entry.grants) ||
      !entry.grants.every(validGrant) ||
      defaults.has(key)
    )
      throw new Error("migration_acl_detail_defaults_invalid");
    defaults.add(key);
  }
  return capture;
}
