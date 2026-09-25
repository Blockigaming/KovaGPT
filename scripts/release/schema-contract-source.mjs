// This is a source statement inventory. It is not a substitute for the
// final database ACL/RLS catalog: conditional SQL and role inheritance need
// an isolated replay and direct database inspection.
export function activePolicyNames(sql) {
  const policies = new Map();
  const events =
    /(?:^|\n)[ \t]*(create|drop)\s+policy\s+(?:if\s+(?:not\s+)?exists\s+)?(?:"([^"]+)"|([a-z_][\w]*))\s+on\s+(?:(?:"?([a-z_][\w]*)"?)\.)?"?([a-z_][\w]*)"?/giu;
  for (const match of sql.matchAll(events)) {
    const name = match[2] ?? match[3];
    const key = `${(match[4] ?? "public").toLowerCase()}.${match[5].toLowerCase()}.${name}`;
    if (match[1].toLowerCase() === "drop") policies.delete(key);
    else policies.set(key, name);
  }
  return [...policies.values()].sort();
}

// Only direct, literal SELECT/ALL statements on one public table are tracked.
// A false value is a recorded direct REVOKE, not an assertion about inherited
// privileges, ownership, SECURITY DEFINER functions or the live target.
export function directTableSelectDecisions(sql) {
  const decisions = new Map();
  const events =
    /(?:^|\n)[ \t]*(grant|revoke)\s+(select|all(?:\s+privileges)?)\s+on\s+(?:table\s+)?(public\.[a-z_][\w]*)\s+(?:to|from)\s+((?:[a-z_][\w]*\s*,\s*)*[a-z_][\w]*)\s*;/giu;
  for (const match of sql.matchAll(events)) {
    const table = match[3].toLowerCase();
    const granted = match[1].toLowerCase() === "grant";
    for (const role of match[4].split(",")) {
      const key = `${table}:${role.trim().toLowerCase()}`;
      decisions.set(key, { table, role: role.trim().toLowerCase(), granted });
    }
  }
  return [...decisions.values()].sort(
    (left, right) => left.table.localeCompare(right.table) || left.role.localeCompare(right.role),
  );
}
