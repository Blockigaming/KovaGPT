import { salesforceQueryUrl, unpackSalesforceCredential } from "./salesforce-credential.server.mjs";

const records = Object.freeze({
  accounts: { object: "Account", prefix: "001", fields: "Id,Name,Industry" },
  contacts: { object: "Contact", prefix: "003", fields: "Id,Name,Title" },
  opportunities: { object: "Opportunity", prefix: "006", fields: "Id,Name,StageName,CloseDate" },
});
function definition(recordType) {
  if (typeof recordType !== "string" || !Object.hasOwn(records, recordType))
    throw new Error("invalid_salesforce_record_type");
  return records[recordType];
}
export function salesforceReadRequest(query, packed, recordType = "accounts") {
  const type = definition(recordType);
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 300 ||
    /[\x00-\x1f]/u.test(query)
  )
    throw new Error("invalid_connection_query");
  const credential = unpackSalesforceCredential(packed);
  const url = salesforceQueryUrl(credential.query_url);
  const literal = query
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  // Only the escaped LIKE literal varies. Object/field names, ordering and the
  // limit are fixed here; callers cannot submit SOQL or arbitrary URLs.
  url.searchParams.set(
    "q",
    `SELECT ${type.fields} FROM ${type.object} WHERE Name LIKE '%${literal}%' ORDER BY Name LIMIT 10`,
  );
  return {
    url: url.href,
    init: {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${credential.access_token}`, Accept: "application/json" },
    },
  };
}
const text = (value, max = 300) => (typeof value === "string" ? value.slice(0, max) : "");
export function salesforceReadResult(data, packed, recordType = "accounts") {
  const type = definition(recordType);
  const origin = salesforceQueryUrl(unpackSalesforceCredential(packed).query_url).origin;
  if (
    !data ||
    !Array.isArray(data.records) ||
    data.records.length > 10 ||
    !Number.isSafeInteger(data.totalSize) ||
    data.totalSize < data.records.length ||
    typeof data.done !== "boolean"
  )
    throw new Error("invalid_connection_response");
  const result = {
    service: "Salesforce",
    results: [],
    limited: data.records.length === 10 || !data.done || data.totalSize > data.records.length,
  };
  for (const row of data.records) {
    if (
      !row ||
      typeof row.Name !== "string" ||
      typeof row.Id !== "string" ||
      !new RegExp(`^${type.prefix}[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$`, "u").test(row.Id)
    )
      throw new Error("invalid_connection_response");
    const item = {
      id: row.Id,
      title: text(row.Name),
      url: `${origin}/${row.Id}`,
      snippet: [row.Industry, row.Title, row.StageName, row.CloseDate]
        .map((value) => text(value, 450))
        .filter(Boolean)
        .join(" · "),
    };
    const next = { ...result, results: [...result.results, item] };
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 24_000) {
      result.limited = true;
      break;
    }
    result.results.push(item);
  }
  return result;
}
