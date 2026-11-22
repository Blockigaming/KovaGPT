import { readProviderJsonObject } from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS, safeConnectionLink } from "./connection-flows.mjs";
import { salesforceReadRequest, salesforceReadResult } from "./salesforce-read.server.mjs";

const str = (value, limit = 2000) => (typeof value === "string" ? value.slice(0, limit) : "");
const notionPageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const title = (page) => {
  const property = Object.values(page.properties ?? {}).find((value) => value?.type === "title");
  return str(
    (property?.title ?? page.title ?? [])
      .map((item) => item.plain_text ?? item.text?.content ?? "")
      .join(""),
    300,
  );
};

export function connectionReadRequest(id, query, token, options = {}) {
  if (!Object.hasOwn(CONNECTION_FLOWS, id)) throw new Error("unsupported_connection");
  if (id === "salesforce") return salesforceReadRequest(query, token, options.recordType);
  if (typeof query !== "string" || !query.trim() || query.length > 300)
    throw new Error("invalid_connection_query");
  query = query.trim();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let url;
  let body;
  if (id === "box") {
    url = new URL("https://api.box.com/2.0/search");
    url.searchParams.set("query", query);
    url.searchParams.set("type", "file");
    url.searchParams.set("fields", "id,type,name,description");
    url.searchParams.set("limit", "10");
  } else if (id === "outlook") {
    url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.searchParams.set("$search", JSON.stringify(query));
    url.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview,webLink");
    url.searchParams.set("$top", "10");
  } else if (id === "outlook-calendar") {
    url = new URL("https://graph.microsoft.com/v1.0/me/calendar/events");
    url.searchParams.set("$filter", `startsWith(subject,'${query.replaceAll("'", "''")}')`);
    url.searchParams.set("$select", "id,subject,start,end,webLink");
    url.searchParams.set("$top", "10");
    headers.Prefer = 'outlook.timezone="UTC"';
  } else if (id === "onedrive") {
    const literal = encodeURIComponent(query.replaceAll("'", "''")).replaceAll("'", "%27");
    url = new URL(`https://graph.microsoft.com/v1.0/me/drive/root/search(q='${literal}')`);
    url.searchParams.set("$select", "id,name,webUrl,description");
    url.searchParams.set("$top", "10");
  } else if (id === "sharepoint") {
    url = new URL("https://graph.microsoft.com/v1.0/sites");
    url.searchParams.set("search", query);
    url.searchParams.set("$select", "id,displayName,webUrl,description");
    url.searchParams.set("$top", "10");
  } else if (id === "ms-teams") {
    url = new URL("https://graph.microsoft.com/v1.0/me/joinedTeams");
  } else if (id === "ms-teams-messages") {
    url = new URL("https://graph.microsoft.com/v1.0/search/query");
    body = JSON.stringify({
      requests: [
        { entityTypes: ["chatMessage"], query: { queryString: query }, from: 0, size: 10 },
      ],
    });
  } else if (id === "notion" && notionPageId.test(query)) {
    url = new URL(`https://api.notion.com/v1/pages/${query}/markdown`);
    url.searchParams.set("markdown_version", "v2");
    headers["Notion-Version"] = "2026-03-11";
  } else if (id === "notion") {
    url = new URL("https://api.notion.com/v1/search");
    headers["Notion-Version"] = "2022-06-28";
    body = JSON.stringify({ query, page_size: 10, filter: { property: "object", value: "page" } });
  } else if (id === "linear") {
    url = new URL("https://api.linear.app/graphql");
    body = JSON.stringify({
      query:
        "query KovaIssueSearch($query: String!) { issues(first: 10, filter: { title: { containsIgnoreCase: $query } }) { nodes { id identifier title description url } } }",
      variables: { query },
    });
  } else if (id === "slack") {
    url = new URL("https://slack.com/api/search.messages");
    url.searchParams.set("query", query);
    url.searchParams.set("count", "10");
  }
  if (body) headers["Content-Type"] = "application/json";
  return {
    url: url.href,
    init: {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    },
  };
}

export async function readConnection(id, query, token, fetchImpl = fetch, options = {}) {
  const request = connectionReadRequest(id, query, token, options);
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "connection_reauthorization_required"
        : response.status === 403
          ? "connection_permission_required"
          : response.status === 429
            ? "connection_rate_limited"
            : "connection_read_failed",
    );
  }
  const data = await readProviderJsonObject(response, 512_000);
  if (id === "salesforce") return salesforceReadResult(data, token, options.recordType);
  if ((id === "slack" && data.ok !== true) || (id === "linear" && data.errors?.length))
    throw new Error("connection_read_failed");
  if (id === "notion" && notionPageId.test(query.trim())) {
    if (
      data.object !== "page_markdown" ||
      typeof data.id !== "string" ||
      data.id.toLowerCase() !== query.trim().toLowerCase() ||
      typeof data.markdown !== "string"
    )
      throw new Error("invalid_connection_response");
    const snippet = str(data.markdown, 3_500);
    return {
      service: "Notion",
      results: [{ id: data.id, title: "Notion page", url: null, snippet }],
      limited:
        data.truncated !== false ||
        !Array.isArray(data.unknown_block_ids) ||
        data.unknown_block_ids.length > 0 ||
        snippet.length < data.markdown.length,
    };
  }
  let rows = data.value;
  if (id === "box") rows = data.entries;
  if (id === "notion") rows = data.results;
  if (id === "linear") rows = data.data?.issues?.nodes;
  if (id === "slack") rows = data.messages?.matches;
  if (id === "ms-teams-messages") {
    const containers = data.value?.[0]?.hitsContainers;
    if (!Array.isArray(containers)) throw new Error("invalid_connection_response");
    rows = containers.flatMap((container) => container?.hits ?? []);
  }
  if (!Array.isArray(rows)) throw new Error("invalid_connection_response");
  if (id === "ms-teams")
    rows = rows.filter((row) =>
      str(row?.displayName).toLowerCase().includes(query.trim().toLowerCase()),
    );
  const result = { service: CONNECTION_FLOWS[id].label, results: [], limited: true };
  const encoder = new TextEncoder();
  for (const hit of rows.slice(0, 10)) {
    const row = id === "ms-teams-messages" ? hit?.resource : hit;
    if (!row || typeof row !== "object") continue;
    if (
      id === "ms-teams-messages" &&
      !["microsoft.graph.chatMessage", "#microsoft.graph.chatMessage"].includes(row["@odata.type"])
    )
      continue;
    let url = row.webLink ?? row.webUrl ?? row.url ?? row.permalink;
    if (id === "box") {
      if (row.type !== "file" || typeof row.id !== "string" || !/^\d{1,32}$/u.test(row.id))
        continue;
      url = `https://app.box.com/file/${row.id}`;
    }
    const item = {
      id: str(row.id ?? row.ts, 300),
      title:
        id === "notion"
          ? title(row)
          : id === "ms-teams-messages"
            ? str(
                row.subject || row.from?.user?.displayName || row.from?.emailAddress?.name,
                300,
              ) || "Teams message"
            : str(row.subject ?? row.name ?? row.displayName ?? row.title ?? row.text, 300),
      url: typeof url === "string" && url.length <= 2048 ? safeConnectionLink(url) : null,
      snippet:
        id === "outlook-calendar"
          ? [
              row.start?.dateTime &&
                `Start: ${str(row.start.dateTime, 60)} (${str(row.start.timeZone, 80)})`,
              row.end?.dateTime &&
                `End: ${str(row.end.dateTime, 60)} (${str(row.end.timeZone, 80)})`,
            ]
              .filter(Boolean)
              .join("; ")
          : id === "ms-teams-messages"
            ? str(hit.summary)
            : str(row.bodyPreview ?? row.description ?? row.text),
    };
    // Measure the serialized UTF-8 result, including JSON escaping. A provider
    // can return control characters or very large URLs; never cut serialized
    // JSON in the chat dispatcher or silently exceed its context boundary.
    const next = { ...result, results: [...result.results, item] };
    if (encoder.encode(JSON.stringify(next)).byteLength > 24_000) break;
    result.results.push(item);
  }
  return result;
}
