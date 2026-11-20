import { readResponseBytesBounded } from "../lib/endpoint-reliability.mjs";
import { OURA_COLLECTIONS } from "./oura-metrics.mjs";

const dayMs = 86_400_000;
const dayString = (time) => new Date(time).toISOString().slice(0, 10);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const requestTimeout = 8_000;

function request(collection, token, from, to, cursor) {
  const url = new URL(collection.collection, "https://api.ouraring.com/v2/usercollection/");
  const timed = collection.collection === "heartrate";
  url.searchParams.set(
    timed ? "start_datetime" : "start_date",
    timed ? new Date(from).toISOString() : dayString(from),
  );
  url.searchParams.set(
    timed ? "end_datetime" : "end_date",
    timed ? new Date(to).toISOString() : dayString(to),
  );
  const fields = new Set(["day"]);
  if (timed) {
    fields.delete("day");
    fields.add("timestamp").add("source");
  }
  if (collection.collection === "sleep") fields.add("type");
  if (collection.collection === "enhanced_tag") (fields.delete("day"), fields.add("start_day"));
  if (collection.collection === "rest_mode_period") {
    fields.delete("day");
    fields.add("start_day").add("start_time").add("end_time");
  }
  for (const field of collection.fields) {
    if (field.path === "$duration" && collection.collection !== "rest_mode_period")
      fields.add("start_datetime").add("end_datetime");
    if (!field.path.startsWith("$")) fields.add(field.path.split(".")[0]);
  }
  url.searchParams.set("fields", [...fields].join(","));
  if (cursor) url.searchParams.set("next_token", cursor);
  return {
    url: url.href,
    init: {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "KovaGPT/1.0",
      },
    },
  };
}

async function responseBody(response, signal) {
  const bytes = await readResponseBytesBounded(response, 512 * 1024, {
    signal,
    timeoutMs: requestTimeout,
  });
  const body = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  if (!Array.isArray(body?.data) || body.data.length > 5000)
    throw new Error("health_response_rejected");
  return body;
}

export async function probeOuraScope(scope, token, fetchImpl) {
  const collection = OURA_COLLECTIONS.find((item) => item.scope === scope);
  if (!collection) return false;
  const now = Date.now();
  const { url, init } = request(collection, token, now - dayMs, now);
  const response = await fetchImpl(url, init);
  if (response.status === 403) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("oauth_scope_check_failed");
  }
  await responseBody(response, init.signal);
  return true;
}

function fieldValue(row, field) {
  if (field.source && row.source !== field.source) return null;
  if (field.path === "$count") return 1;
  if (field.path === "$duration") {
    const seconds =
      (Date.parse(row.end_datetime ?? row.end_time) -
        Date.parse(row.start_datetime ?? row.start_time)) /
      1000;
    return seconds >= 0 ? seconds * field.scale : null;
  }
  const path = field.path.split(".");
  const operator = path.at(-1)?.startsWith("$") ? path.pop() : null;
  const value = path.reduce((value, key) => value?.[key], row);
  if (field.categories) {
    const position = Object.keys(field.categories).indexOf(value);
    return position < 0 ? null : position;
  }
  if (operator) {
    const samples = Array.isArray(value?.items) ? value.items : [];
    const readings = samples.filter(Number.isFinite);
    return readings.length
      ? readings.reduce((sum, point) => sum + point, 0) /
          (operator === "$mean" ? readings.length : 1)
      : null;
  }
  return Number.isFinite(value) && Math.abs(value) <= 100_000_000 ? value * field.scale : null;
}

function addReadings(series, collection, data, first, last) {
  for (const row of data) {
    if (!row || typeof row !== "object" || row.type === "deleted") continue;
    const timestamp = row.timestamp ?? row.end_datetime ?? row.start_time;
    const day =
      row.day ?? row.start_day ?? (typeof timestamp === "string" ? timestamp.slice(0, 10) : "");
    if (typeof day !== "string" || !datePattern.test(day) || day < first || day > last) continue;
    for (const field of collection.fields) {
      const value = fieldValue(row, field);
      if (value === null || !Number.isFinite(value)) continue;
      const days = series.get(field.id);
      const prior = days.get(day) ?? {
        total: 0,
        min: Infinity,
        count: 0,
        latest: -Infinity,
        recent: value,
      };
      prior.total += value;
      prior.min = Math.min(value, prior.min);
      prior.count += 1;
      const time = Date.parse(timestamp ?? day);
      if (time >= prior.latest) {
        prior.latest = time;
        prior.recent = value;
      }
      days.set(day, prior);
    }
  }
}

export async function readOuraAnalytics(
  scopes,
  token,
  ensureCurrent,
  fetchImpl = fetch,
  now = Date.now(),
) {
  if (typeof token !== "string" || !token || token.length > 8192 || /[\r\n]/u.test(token))
    throw new Error("invalid_health_token");
  const asOf = dayString(now);
  const earliest = dayString(now - 364 * dayMs);
  const byId = new Map(
    OURA_COLLECTIONS.flatMap(({ fields }) => fields.map(({ id }) => [id, new Map()])),
  );
  const allowed = OURA_COLLECTIONS.filter(({ scope }) => scopes.includes(scope));
  const missing = [
    ...new Set(
      OURA_COLLECTIONS.filter(({ scope }) => !scopes.includes(scope)).map(({ scope }) => scope),
    ),
  ];
  const unavailable = [];
  let limited = false;
  if (!allowed.length) throw new Error("health_permission_required");

  // Six groups of small requests keep one slow or unavailable collection from hiding the rest.
  const deadline = Date.now() + 28_000;
  for (let start = 0; start < allowed.length; start += 5) {
    await ensureCurrent();
    const results = await Promise.allSettled(
      allowed.slice(start, start + 5).map(async (collection) => {
        const recent = collection.collection === "heartrate";
        const from = now - (recent ? 2 : 364) * dayMs;
        const cursors = new Set();
        let cursor;
        for (let page = 0; page < (recent ? 7 : 4); page += 1) {
          if (Date.now() >= deadline) {
            limited = true;
            return;
          }
          const { url, init } = request(collection, token, from, now, cursor);
          const response = await fetchImpl(url, init);
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401) throw new Error("health_reconnect_required");
            throw new Error(collection.collection);
          }
          const body = await responseBody(response, init.signal);
          addReadings(byId, collection, body.data, earliest, asOf);
          cursor = body.next_token;
          if (typeof cursor !== "string" || !cursor) return;
          if (cursor.length > 2048 || cursors.has(cursor)) {
            limited = true;
            return;
          }
          cursors.add(cursor);
        }
        limited = true;
      }),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      if (result.reason?.message === "health_reconnect_required") throw result.reason;
      unavailable.push(allowed[start + index].collection);
    });
  }
  await ensureCurrent();
  const metrics = Object.fromEntries(
    allowed.flatMap(({ fields }) =>
      fields.flatMap((field) => {
        const days = [...byId.get(field.id)]
          .map(([date, point]) => ({
            date,
            value:
              field.aggregation === "sum"
                ? point.total
                : field.aggregation === "min"
                  ? point.min
                  : field.aggregation === "last" || field.aggregation === "category"
                    ? point.recent
                    : point.total / point.count,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
        return days.length ? [[field.id, [{ name: "Oura", days }]]] : [];
      }),
    ),
  );
  return { asOf, metrics, missing, unavailable, limited, fetchedAt: new Date(now).toISOString() };
}
