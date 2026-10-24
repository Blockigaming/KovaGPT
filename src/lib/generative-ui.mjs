const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_WIDGET_BYTES = 96 * 1024;
const MAX_WIDGETS = 8;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const encoder = new TextEncoder();

function record(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  return (
    names.every(
      (name) =>
        typeof name === "string" &&
        (required.includes(name) || optional.includes(name)) &&
        descriptors[name].enumerable &&
        Object.hasOwn(descriptors[name], "value"),
    ) && required.every((name) => Object.hasOwn(descriptors, name))
  );
}

function list(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(descriptors).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => descriptors[index]).every(
      (descriptor) => descriptor && Object.hasOwn(descriptor, "value"),
    )
  );
}

function text(value, maximum, allowEmpty = false) {
  return (
    typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0)
  );
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01")
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function uniqueIds(items) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function normalize(value) {
  const base = ["version", "type", "title"];
  if (!value || typeof value !== "object") return null;
  // Inspect data descriptors before reading fields, so an external object with
  // accessors cannot run code while being considered for a widget.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    !Object.hasOwn(descriptors.type ?? {}, "value") ||
    !Object.hasOwn(descriptors.version ?? {}, "value") ||
    !Object.hasOwn(descriptors.title ?? {}, "value")
  )
    return null;
  if (value.version !== 1 || !text(value.title, 160)) return null;
  const common = { version: 1, type: value.type, title: value.title.trim() };
  switch (value.type) {
    case "document":
      if (!record(value, [...base, "content"]) || !text(value.content, 64_000, true)) return null;
      return { ...common, content: value.content };
    case "code":
      if (
        !record(value, [...base, "language", "content"]) ||
        !text(value.content, 64_000, true) ||
        typeof value.language !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9#+.-]{0,31}$/.test(value.language)
      )
        return null;
      return { ...common, language: value.language, content: value.content };
    case "date":
      if (
        !record(value, [...base, "value"], ["min", "max"]) ||
        (value.value !== "" && !date(value.value)) ||
        (Object.hasOwn(value, "min") && !date(value.min)) ||
        (Object.hasOwn(value, "max") && !date(value.max)) ||
        (value.min && value.max && value.min > value.max) ||
        (value.value && value.min && value.value < value.min) ||
        (value.value && value.max && value.value > value.max)
      )
        return null;
      return {
        ...common,
        value: value.value,
        ...(Object.hasOwn(value, "min") ? { min: value.min } : {}),
        ...(Object.hasOwn(value, "max") ? { max: value.max } : {}),
      };
    case "timeline": {
      if (!record(value, [...base, "items"]) || !list(value.items, 1, 64)) return null;
      const items = [];
      for (const item of value.items) {
        if (
          !record(item, ["id", "title", "start", "end", "status"]) ||
          typeof item.id !== "string" ||
          !ID.test(item.id) ||
          !text(item.title, 200) ||
          !date(item.start) ||
          !date(item.end) ||
          item.start > item.end ||
          !["planned", "doing", "done"].includes(item.status)
        )
          return null;
        items.push({
          id: item.id,
          title: item.title.trim(),
          start: item.start,
          end: item.end,
          status: item.status,
        });
      }
      return uniqueIds(items) ? { ...common, items } : null;
    }
    case "board": {
      if (
        !record(value, [...base, "columns", "cards"]) ||
        !list(value.columns, 1, 6) ||
        !list(value.cards, 0, 64)
      )
        return null;
      const columns = [];
      for (const column of value.columns) {
        if (
          !record(column, ["id", "title"]) ||
          typeof column.id !== "string" ||
          !ID.test(column.id) ||
          !text(column.title, 200)
        )
          return null;
        columns.push({ id: column.id, title: column.title.trim() });
      }
      if (!uniqueIds(columns)) return null;
      const cards = [];
      for (const card of value.cards) {
        if (
          !record(card, ["id", "title", "columnId"], ["body"]) ||
          typeof card.id !== "string" ||
          !ID.test(card.id) ||
          !text(card.title, 200) ||
          !columns.some((column) => column.id === card.columnId) ||
          (Object.hasOwn(card, "body") && !text(card.body, 4_000, true))
        )
          return null;
        cards.push({
          id: card.id,
          title: card.title.trim(),
          columnId: card.columnId,
          ...(Object.hasOwn(card, "body") ? { body: card.body } : {}),
        });
      }
      return uniqueIds(cards) ? { ...common, columns, cards } : null;
    }
    default:
      return null;
  }
}

/** A closed data schema. Text is rendered by React; no HTML, JS or actions run. */
export function validateGenerativeWidget(value) {
  try {
    const result = normalize(value);
    return result && encoder.encode(JSON.stringify(result)).byteLength <= MAX_WIDGET_BYTES
      ? result
      : null;
  } catch {
    return null;
  }
}

/**
 * Complete top-level kova-ui fences become widgets. Everything else, including
 * malformed or unfinished JSON and fences nested in other code, remains text.
 * This function never rewrites the original message or loses rejected bytes.
 */
export function splitGenerativeContent(value) {
  if (typeof value !== "string" || !value) return [];
  if (value.length > MAX_MESSAGE_BYTES || encoder.encode(value).byteLength > MAX_MESSAGE_BYTES)
    return [{ kind: "text", text: value }];
  const parts = [];
  let offset = 0;
  let emitted = 0;
  let widgets = 0;
  let fence = null;
  for (const line of value.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(line);
    if (!fence && marker) {
      fence = {
        character: marker[1][0],
        length: marker[1].length,
        start: offset,
        body: offset + line.length,
        widget: marker[2].trim() === "kova-ui",
      };
    } else if (
      fence &&
      marker &&
      marker[1][0] === fence.character &&
      marker[1].length >= fence.length &&
      !marker[2].trim()
    ) {
      if (fence.widget && widgets < MAX_WIDGETS) {
        const body = value.slice(fence.body, offset);
        let widget = null;
        if (body.length <= MAX_WIDGET_BYTES && encoder.encode(body).byteLength <= MAX_WIDGET_BYTES)
          try {
            widget = validateGenerativeWidget(JSON.parse(body));
          } catch {
            // Preserve the rejected source in the ordinary text segment.
          }
        if (widget) {
          if (fence.start > emitted)
            parts.push({ kind: "text", text: value.slice(emitted, fence.start) });
          const end = offset + line.length;
          parts.push({ kind: "widget", widget, source: value.slice(fence.start, end) });
          widgets += 1;
          emitted = end;
        }
      }
      fence = null;
    }
    offset += line.length;
  }
  if (emitted < value.length) parts.push({ kind: "text", text: value.slice(emitted) });
  return parts;
}

export const GENERATIVE_UI_INSTRUCTIONS = `When a task benefits from an editable canvas, date picker, timeline or idea board, you may emit a complete fenced kova-ui JSON object. Otherwise answer normally. Only these exact version-1 shapes are supported:
document: {"version":1,"type":"document","title":"Draft","content":"Editable text"}
code: {"version":1,"type":"code","title":"Code","language":"javascript","content":"Source text"}
date: {"version":1,"type":"date","title":"Choose a date","value":"","min":"2026-01-01","max":"2027-12-31"} (min/max optional; value empty or a real YYYY-MM-DD)
timeline: {"version":1,"type":"timeline","title":"Plan","items":[{"id":"step-1","title":"First step","start":"2026-01-01","end":"2026-01-02","status":"planned"}]}
board: {"version":1,"type":"board","title":"Ideas","columns":[{"id":"ideas","title":"Ideas"}],"cards":[{"id":"idea-1","title":"An idea","columnId":"ideas","body":"Optional detail"}]}
Use only listed keys and types; timeline status is planned, doing or done. Dates must be real and ordered; use actual user-supplied dates rather than inventing deadlines. IDs use letters, digits, hyphens or underscores. At most 8 widgets per response, 6 board columns and 64 items/cards. Titles are at most 160 characters; content at most 64000 characters. These are editable drafts only: never claim a widget booked, sent, saved, scheduled or executed anything. Do not attach executable handlers, HTML rendering directives, navigation actions or hidden reasoning. Document/code content remains inert source text. A progress label must describe an observed operation, not fabricated thinking.`;
