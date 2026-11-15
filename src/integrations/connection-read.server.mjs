import { readProviderJsonObject } from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS, safeConnectionLink } from "./connection-flows.mjs";
import { salesforceReadRequest, salesforceReadResult } from "./salesforce-read.server.mjs";

const notionBlockId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const str = (value, limit = 2000) => (typeof value === "string" ? value.slice(0, limit) : "");
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
  if (id === "outlook") {
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
  } else if (id === "notion") {
    headers["Notion-Version"] = "2022-06-28";
    if (options.notionPage) {
      if (!notionBlockId.test(query)) throw new Error("invalid_notion_page_id");
      url = new URL(`https://api.notion.com/v1/blocks/${query}/children?page_size=20`);
    } else {
      url = new URL("https://api.notion.com/v1/search");
      body = JSON.stringify({
        query,
        page_size: 10,
        filter: { property: "object", value: "page" },
      });
    }
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

async function readConnectionJson(request, fetchImpl) {
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
  return readProviderJsonObject(response, 512_000);
}

async function readNotionText(root, query, token, fetchImpl, options, signal) {
  const blocks = [];
  let limited = false;
  let remainingRequests = 3;
  let remainingBlocks = 40;
  let remainingBytes = 20_000;
  const encoder = new TextEncoder();
  const seen = new Set([query.trim().toLowerCase()]);

  async function visit(data, depth) {
    if (!Array.isArray(data.results)) throw new Error("invalid_connection_response");
    if (data.has_more === true || data.results.length > 20) limited = true;
    for (const row of data.results.slice(0, 20)) {
      if (remainingBlocks === 0 || remainingBytes === 0) {
        limited = true;
        break;
      }
      remainingBlocks -= 1;
      if (row?.object !== "block" || typeof row.type !== "string") {
        limited = true;
        continue;
      }
      const richText = row[row.type]?.rich_text;
      if (Array.isArray(richText)) {
        const text = richText.map((item) => str(item?.plain_text, 2000)).join("");
        if (text.length > 1500) limited = true;
        const block = { type: str(row.type, 40), text: text.slice(0, 1500) };
        const bytes = encoder.encode(JSON.stringify(block)).byteLength + 1;
        if (bytes > remainingBytes) {
          remainingBytes = 0;
          limited = true;
          break;
        }
        remainingBytes -= bytes;
        blocks.push(block);
      } else {
        limited = true;
      }

      if (row.has_children !== true) continue;
      const childId = typeof row.id === "string" ? row.id.toLowerCase() : "";
      // Keep a page read within a small request budget. Linked pages and
      // synced blocks can point at content outside the requested page.
      if (
        depth === 2 ||
        remainingRequests === 0 ||
        remainingBlocks === 0 ||
        remainingBytes === 0 ||
        !notionBlockId.test(childId) ||
        seen.has(childId) ||
        ["child_page", "child_database", "link_to_page", "synced_block"].includes(row.type)
      ) {
        limited = true;
        continue;
      }
      seen.add(childId);
      remainingRequests -= 1;
      await options.ensureCurrent?.();
      const childRequest = connectionReadRequest("notion", childId, token, options);
      const children = await readConnectionJson(
        { ...childRequest, init: { ...childRequest.init, signal } },
        fetchImpl,
      );
      await visit(children, depth + 1);
    }
  }

  await visit(root, 0);
  return { service: "Notion", page_id: query.trim(), blocks, limited };
}

export async function readConnection(id, query, token, fetchImpl = fetch, options = {}) {
  const request = connectionReadRequest(id, query, token, options);
  const data = await readConnectionJson(request, fetchImpl);
  if (id === "salesforce") return salesforceReadResult(data, token, options.recordType);
  if (id === "notion" && options.notionPage)
    return readNotionText(data, query, token, fetchImpl, options, request.init.signal);
  if ((id === "slack" && data.ok !== true) || (id === "linear" && data.errors?.length))
    throw new Error("connection_read_failed");
  let rows =
    id === "notion"
      ? data.results
      : id === "linear"
        ? data.data?.issues?.nodes
        : id === "slack"
          ? data.messages?.matches
          : data.value;
  if (!Array.isArray(rows)) throw new Error("invalid_connection_response");
  if (id === "ms-teams")
    rows = rows.filter((row) =>
      str(row.displayName).toLowerCase().includes(query.trim().toLowerCase()),
    );
  const result = { service: CONNECTION_FLOWS[id].label, results: [], limited: true };
  const encoder = new TextEncoder();
  for (const row of rows.slice(0, 10)) {
    const url = row.webLink ?? row.webUrl ?? row.url ?? row.permalink;
    const item = {
      id: str(row.id ?? row.ts, 300),
      title:
        id === "notion"
          ? title(row)
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
