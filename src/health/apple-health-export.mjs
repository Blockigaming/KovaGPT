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

export async function readAppleHealthExport(file, signal) {
  const { stream, size } = await openExportXml(file);
  if (size < 1 || size > xmlLimit) throw new Error("Unsupported Apple Health export size");
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const sources = new Map();
  const week = 7 * 86_400_000;
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
      for (const match of tags.matchAll(/<(\/?HealthData|ExportDate|Record)(?=[\s/>])[^>]*>/g)) {
        if (match[1] === "HealthData") hasRoot = true;
        if (match[1] === "/HealthData") complete = true;
        if (!hasRoot || complete) continue;
        if (match[1] === "ExportDate") {
          exportDay ??= calendarDay(readAttributes(match[0]).value);
          continue;
        }
        if (
          !exportDay ||
          match[1] !== "Record" ||
          !match[0].includes("HKQuantityTypeIdentifierStepCount")
        ) {
          continue;
        }
        const record = readAttributes(match[0]);
        if (record.type !== "HKQuantityTypeIdentifierStepCount" || record.unit !== "count")
          continue;
        const date = calendarDay(record.startDate);
        if (!date || date.time > exportDay.time || exportDay.time - date.time >= week) continue;
        const steps = Number(record.value);
        if (!record.value || !Number.isFinite(steps) || steps < 0 || steps > 1_000_000) continue;
        const source = sourceName(record.sourceName?.trim().slice(0, 160) || "Unknown source");
        if (!sources.has(source)) {
          if (sources.size >= 128) throw new Error("Too many Apple Health sources");
          sources.set(source, new Map());
        }
        const byDay = sources.get(source);
        byDay.set(date.day, (byDay.get(date.day) ?? 0) + steps);
      }
    }
    if (bytes !== size || !complete || !exportDay || (buffer + decoder.decode()).trim()) {
      throw new Error("Incomplete Apple Health export");
    }
    return Array.from(sources, ([name, days]) => ({
      name,
      days: Array.from(days, ([date, steps]) => ({ date, steps: Math.round(steps) })).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    })).sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
