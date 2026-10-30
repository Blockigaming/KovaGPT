import { readProviderJsonObject } from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS, safeConnectionLink } from "./connection-flows.mjs";

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

export function connectionReadRequest(id, query, token) {
  if (!Object.hasOwn(CONNECTION_FLOWS, id)) throw new Error("unsupported_connection");
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

export async function readConnection(id, query, token, fetchImpl = fetch) {
  const request = connectionReadRequest(id, query, token);
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
  return {
    service: CONNECTION_FLOWS[id].label,
    results: rows.slice(0, 10).map((row) => ({
      id: str(row.id ?? row.ts, 300),
      title:
        id === "notion"
          ? title(row)
          : str(row.subject ?? row.name ?? row.displayName ?? row.title ?? row.text, 300),
      url: safeConnectionLink(row.webLink ?? row.webUrl ?? row.url ?? row.permalink),
      snippet: str(row.bodyPreview ?? row.description ?? row.text),
    })),
    limited: true,
  };
}
