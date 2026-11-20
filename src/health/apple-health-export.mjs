import {
  APPLE_HEALTH_DAY_MS,
  APPLE_HEALTH_HISTORY_DAYS,
  APPLE_HEALTH_METRICS,
} from "./apple-health-metrics.mjs";

const zipEnd = 0x06054b50;
const zipEntry = 0x02014b50;
const zipLocal = 0x04034b50;
const xmlLimit = 512 * 1024 * 1024;

async function openExportXml(file) {
  if (/\.xml$/i.test(file.name)) return { stream: file.stream(), size: file.size };
  if (!/\.zip$/i.test(file.name)) throw new Error("Unsupported export format");

  const tailStart = Math.max(0, file.size - 65_557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (
    end >= 0 &&
    (tail.getUint32(end, true) !== zipEnd ||
      end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)
  ) {
    end -= 1;
  }
  if (end < 0 || tail.getUint32(end + 4, true) !== 0) throw new Error("Invalid ZIP archive");
  const bytes = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (bytes > 16 * 1024 * 1024 || offset + bytes !== tailStart + end) {
    throw new Error("Unsupported ZIP directory");
  }
  const directory = new DataView(await file.slice(offset, offset + bytes).arrayBuffer());
  const decoder = new TextDecoder();
  for (let entry = 0; entry + 46 <= bytes;) {
    if (directory.getUint32(entry, true) !== zipEntry) throw new Error("Invalid ZIP directory");
    const nameSize = directory.getUint16(entry + 28, true);
    const extraSize = directory.getUint16(entry + 30, true);
    const commentSize = directory.getUint16(entry + 32, true);
    if (entry + 46 + nameSize + extraSize + commentSize > bytes) break;
    const name = decoder.decode(new Uint8Array(directory.buffer, entry + 46, nameSize));
    if (name === "apple_health_export/export.xml" || name === "export.xml") {
      const method = directory.getUint16(entry + 10, true);
      const compressed = directory.getUint32(entry + 20, true);
      const size = directory.getUint32(entry + 24, true);
      const localOffset = directory.getUint32(entry + 42, true);
      if (
        (directory.getUint16(entry + 8, true) & 1) !== 0 ||
        (method !== 0 && method !== 8) ||
        size > xmlLimit ||
        localOffset + 30 + compressed > offset
      ) {
        throw new Error("Unsupported ZIP entry");
      }
      const header = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
      if (header.getUint32(0, true) !== zipLocal) throw new Error("Invalid ZIP entry");
      const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      if (start + compressed > offset) throw new Error("Truncated ZIP entry");
      const stream = file.slice(start, start + compressed).stream();
      return {
        stream: method === 8 ? stream.pipeThrough(new DecompressionStream("deflate-raw")) : stream,
        size,
      };
    }
    entry += 46 + nameSize + extraSize + commentSize;
  }
  throw new Error("Apple Health XML missing from ZIP");
}

function readAttributes(tag) {
  const attributes = Object.create(null);
  for (const match of tag.matchAll(/\s([a-zA-Z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = match[2] ?? match[3];
  }
  return attributes;
}

const xmlEntities = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">" };
function sourceName(value) {
  return value.replace(/&(amp|apos|quot|lt|gt|#\d+|#x[\da-fA-F]+);/g, (entity, name) => {
    if (name[0] !== "#") return xmlEntities[name];
    const code = name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function calendarDay(value) {
  const day = value?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day
    ? { day, time }
    : null;
}

const metricsByType = new Map(APPLE_HEALTH_METRICS.map((metric) => [metric.type, metric]));

function instant(value) {
  return Date.parse(value?.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2") ?? "");
}

function asleepHours(intervals) {
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total / 3_600_000;
}

export async function readAppleHealthExport(file, signal) {
  const { stream, size } = await openExportXml(file);
  if (size < 1 || size > xmlLimit) throw new Error("Unsupported Apple Health export size");
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const metrics = new Map();
  const sourceSet = new Set();
  const history = APPLE_HEALTH_HISTORY_DAYS * APPLE_HEALTH_DAY_MS;
  let buffer = "";
  let exportDay;
  let hasRoot = false;
  let complete = false;
  let bytes = 0;

  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > size) throw new Error("Apple Health XML exceeds its declared size");
      buffer += decoder.decode(value, { stream: true });
      const end = buffer.lastIndexOf(">");
      if (end < 0) {
        if (buffer.length > 128 * 1024) throw new Error("Invalid Apple Health XML");
        continue;
      }
      const tags = buffer.slice(0, end + 1);
      buffer = buffer.slice(end + 1);
      for (const match of tags.matchAll(
        /<(\/?HealthData|ExportDate|Record|Workout)(?=[\s/>])[^>]*>/g,
      )) {
        if (match[1] === "HealthData") hasRoot = true;
        if (match[1] === "/HealthData") complete = true;
        if (!hasRoot || complete) continue;
        if (match[1] === "ExportDate") {
          exportDay ??= calendarDay(readAttributes(match[0]).value);
          continue;
        }
        if (!exportDay) continue;
        const record = readAttributes(match[0]);
        const metric = metricsByType.get(match[1] === "Workout" ? "Workout" : record.type);
        if (!metric) continue;
        const date = calendarDay(
          metric.aggregation === "sleep" ? record.endDate : record.startDate,
        );
        if (!date || date.time > exportDay.time || exportDay.time - date.time >= history) continue;
        const value =
          metric.type === "Workout" ? 1 : Number(record.value) * metric.units?.[record.unit];
        let interval;
        let timestamp;
        if (metric.aggregation === "sleep") {
          if (
            !/^HKCategoryValueSleepAnalysisAsleep(?:Unspecified|Core|Deep|REM)?$/.test(
              record.value ?? "",
            )
          )
            continue;
          const start = instant(record.startDate);
          const end = instant(record.endDate);
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start ||
            end - start > APPLE_HEALTH_DAY_MS
          )
            continue;
          interval = [start, end];
        } else if (
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1_000_000 ||
          (metric.type !== "Workout" && !record.value?.trim())
        ) {
          continue;
        } else if (metric.aggregation === "last") {
          timestamp = instant(record.startDate);
          if (!Number.isFinite(timestamp)) timestamp = date.time;
        }
        const source = sourceName(record.sourceName?.trim().slice(0, 160) || "Unknown source");
        sourceSet.add(source);
        if (sourceSet.size > 128) throw new Error("Too many Apple Health sources");
        if (!metrics.has(metric.id)) metrics.set(metric.id, new Map());
        const sources = metrics.get(metric.id);
        if (!sources.has(source)) sources.set(source, new Map());
        const days = sources.get(source);
        if (!days.has(date.day)) days.set(date.day, { total: 0, count: 0, time: -Infinity });
        const day = days.get(date.day);
        if (interval) {
          day.intervals ??= [];
          if (day.intervals.length >= 1000) throw new Error("Too many sleep intervals");
          day.intervals.push(interval);
        } else if (timestamp === undefined) {
          day.total += value;
        } else if (timestamp >= day.time) {
          day.total = value;
          day.time = timestamp;
        }
        day.count += 1;
      }
    }
    if (bytes !== size || !complete || !exportDay || (buffer + decoder.decode()).trim()) {
      throw new Error("Incomplete Apple Health export");
    }
    const report = { asOf: exportDay.day, metrics: {} };
    for (const metric of APPLE_HEALTH_METRICS) {
      const sources = metrics.get(metric.id);
      if (!sources) continue;
      report.metrics[metric.id] = Array.from(sources, ([name, days]) => ({
        name,
        days: Array.from(days, ([date, day]) => ({
          date,
          value: day.intervals
            ? asleepHours(day.intervals)
            : day.total / (metric.aggregation === "avg" ? day.count : 1),
        })).sort((a, b) => a.date.localeCompare(b.date)),
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return report;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
