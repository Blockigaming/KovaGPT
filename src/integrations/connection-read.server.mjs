import { readProviderJsonObject } from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS, safeConnectionLink } from "./connection-flows.mjs";
import { salesforceReadRequest, salesforceReadResult } from "./salesforce-read.server.mjs";

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
  } else if (id === "calendly") {
    const uri = options.calendlyUserUri;
    if (
      typeof uri !== "string" ||
      !/^https:\/\/api\.calendly\.com\/users\/[a-zA-Z0-9_-]+$/u.test(uri)
    )
      throw new Error("calendly_identity_unavailable");
    url = new URL("https://api.calendly.com/scheduled_events");
    url.searchParams.set("user", uri);
    url.searchParams.set("count", "100");
    url.searchParams.set("sort", "start_time:desc");
  } else if (id === "canva") {
    if (query.length > 255) throw new Error("invalid_connection_query");
    url = new URL("https://api.canva.com/rest/v1/designs");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "10");
  } else if (id === "dropbox") {
    url = new URL("https://api.dropboxapi.com/2/files/search_v2");
    body = JSON.stringify({ query, options: { max_results: 10 } });
  } else if (id === "box") {
    url = new URL("https://api.box.com/2.0/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "10");
    url.searchParams.set("type", "file");
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
  if (id === "calendly") {
    // Resolve the owner through the authenticated API, never from a user query.
    const profileResponse = await fetchImpl("https://api.calendly.com/users/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!profileResponse.ok) {
      await profileResponse.body?.cancel();
      throw new Error(
        profileResponse.status === 401
          ? "connection_reauthorization_required"
          : profileResponse.status === 403
            ? "connection_permission_required"
            : "connection_read_failed",
      );
    }
    const profile = await readProviderJsonObject(profileResponse, 64_000);
    const uri = profile.resource?.uri;
    if (
      typeof uri !== "string" ||
      uri !== options.calendlyExpectedUserUri ||
      !/^https:\/\/api\.calendly\.com\/users\/[a-zA-Z0-9_-]+$/u.test(uri)
    )
      throw new Error("calendly_identity_changed");
    options = { ...options, calendlyUserUri: uri };
  }
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
  let rows = data.value;
  if (id === "calendly") {
    rows = data.collection;
  } else if (id === "notion") {
    rows = data.results;
  } else if (id === "linear") {
    rows = data.data?.issues?.nodes;
  } else if (id === "slack") {
    rows = data.messages?.matches;
  } else if (id === "dropbox") {
    rows = data.matches;
  } else if (id === "box") {
    rows = data.entries;
  } else if (id === "canva") {
    rows = data.items;
  }
  if (!Array.isArray(rows)) throw new Error("invalid_connection_response");
  if (id === "ms-teams" || id === "calendly")
    rows = rows.filter((row) =>
      str(id === "calendly" ? row.name : row.displayName)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const result = { service: CONNECTION_FLOWS[id].label, results: [], limited: true };
  const encoder = new TextEncoder();
  for (const match of rows.slice(0, 10)) {
    // Dropbox search matches wrap the actual file/folder metadata twice.
    const row = id === "dropbox" ? match?.metadata?.metadata : match;
    if (!row || typeof row !== "object") continue;
    const url = row.webLink ?? row.webUrl ?? row.url ?? row.permalink ?? row.shared_link?.url;
    const safeUrl =
      ["calendly", "canva"].includes(id) || typeof url !== "string" || url.length > 2048
        ? null
        : safeConnectionLink(url);
    let snippet = str(row.bodyPreview ?? row.description ?? row.text);
    if (id === "outlook-calendar") {
      snippet = [
        row.start?.dateTime &&
          `Start: ${str(row.start.dateTime, 60)} (${str(row.start.timeZone, 80)})`,
        row.end?.dateTime && `End: ${str(row.end.dateTime, 60)} (${str(row.end.timeZone, 80)})`,
      ]
        .filter(Boolean)
        .join("; ");
    } else if (id === "calendly") {
      snippet = [
        row.start_time && `Start: ${str(row.start_time, 60)}`,
        row.end_time && `End: ${str(row.end_time, 60)}`,
      ]
        .filter(Boolean)
        .join("; ");
    } else if (id === "dropbox") {
      snippet = str(row.path_display);
    } else if (id === "canva") {
      snippet = Array.isArray(row.design_types)
        ? row.design_types.filter((item) => typeof item === "string").slice(0, 3).join(", ")
        : "";
    }
    const item = {
      id: str(row.id ?? row.ts ?? (id === "calendly" ? row.uri : ""), 300),
      title:
        id === "notion"
          ? title(row)
          : str(row.subject ?? row.name ?? row.displayName ?? row.title ?? row.text, 300),
      url: safeUrl,
      snippet,
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
