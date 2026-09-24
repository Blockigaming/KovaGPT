import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The SQL connector returns the last SELECT of a multi-statement request. Nest
// both reviewed collectors in that SELECT so their catalogs and the full
// migration ledger are observed in one read-only repeatable-read transaction.
function collectorBody(source) {
  const begin =
    /\bbegin(?:\s+transaction)?\s+isolation\s+level\s+repeatable\s+read\s+read\s+only\s*;/iu.exec(
      source,
    );
  if (!begin || !/^(?:\s|--[^\n]*\n)*$/u.test(source.slice(0, begin.index))) {
    throw new Error("catalog_collector_read_only_begin_required");
  }
  const remainder = source.slice(begin.index + begin[0].length).trim();
  const match = /^(with\b[\s\S]*);\s*commit;\s*$/iu.exec(remainder);
  if (!match || match[1].includes(";")) {
    throw new Error("catalog_collector_single_select_and_commit_required");
  }
  return match[1];
}

export function buildCombinedPrivilegeCatalogCapture(privilegeSql, helperSql) {
  const privilege = collectorBody(privilegeSql);
  const helpers = collectorBody(helperSql);
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH privilege AS (
${privilege}
), helpers AS (
${helpers}
), ledger AS (
  SELECT count(*)::int AS migration_count,
         sum(coalesce(array_length(statements,1),0))::int AS statement_count,
         jsonb_agg(jsonb_build_object(
           'version',version::text,
           'statementCount',coalesce(array_length(statements,1),0),
           'capturedStatementsSha256',encode(extensions.digest(
             convert_to(array_to_string(statements,E'\\n'),'UTF8'),'sha256'),'hex')
         ) ORDER BY version::text COLLATE "C") AS rows
  FROM supabase_migrations.schema_migrations
)
SELECT jsonb_build_object(
 'capturedAt',statement_timestamp(),
 'isolation',current_setting('transaction_isolation'),
 'readOnly',current_setting('transaction_read_only'),
 'databaseName',current_database(),
 'serverVersionNum',current_setting('server_version_num'),
 'ledger',(SELECT to_jsonb(ledger) FROM ledger),
 'privilege',(SELECT aggregate_counts FROM privilege),
 'helpers',(SELECT to_jsonb(helpers) FROM helpers)
) AS evidence;
COMMIT;
`;
}

export function collectorSha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const privilegeSql = readFileSync(
    new URL("./privilege-live-violation-counts.sql", import.meta.url),
    "utf8",
  );
  const helperSql = readFileSync(
    new URL("./rls-helper-live-aggregate.sql", import.meta.url),
    "utf8",
  );
  process.stdout.write(buildCombinedPrivilegeCatalogCapture(privilegeSql, helperSql));
}
