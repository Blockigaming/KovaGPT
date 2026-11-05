// Model-generated interactive response components ("kova-interactive" fences).
// A closed, strictly validated data schema: React renders every string as text,
// nothing here can carry HTML, scripts, URLs to navigate, or event handlers.

const MAX_MESSAGE_CHARS = 128 * 1024;
const MAX_BLOCK_CHARS = 32 * 1024;
const MAX_BLOCKS = 6;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const FIELD_KINDS = [
  "text",
  "textarea",
  "number",
  "radio",
  "checkbox",
  "select",
  "slider",
  "date",
  "toggle",
];

const isPlain = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const onlyKeys = (v, allowed) => Object.keys(v).every((k) => allowed.includes(k));
const str = (v, max, allowEmpty = false) =>
  typeof v === "string" && v.length <= max && (allowEmpty || v.trim().length > 0);
const num = (v) => typeof v === "number" && Number.isFinite(v);
const isDate = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const uniq = (ids) => new Set(ids).size === ids.length;

function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 1 || options.length > 24) return null;
  const out = [];
  for (const o of options) {
    if (!isPlain(o) || !onlyKeys(o, ["value", "label"])) return null;
    if (!str(o.value, 120) || !str(o.label, 200)) return null;
    out.push({ value: o.value, label: o.label.trim() });
  }
  return uniq(out.map((o) => o.value)) ? out : null;
}

function validateField(f) {
  const keys = ["id", "label", "kind", "required", "help", "placeholder", "options", "min", "max", "step", "default"];
  if (!isPlain(f) || !onlyKeys(f, keys)) return null;
  if (typeof f.id !== "string" || !ID.test(f.id) || !str(f.label, 200)) return null;
  if (!FIELD_KINDS.includes(f.kind)) return null;
  if ("required" in f && typeof f.required !== "boolean") return null;
  if ("help" in f && !str(f.help, 400)) return null;
  if ("placeholder" in f && !str(f.placeholder, 200)) return null;
  const field = { id: f.id, label: f.label.trim(), kind: f.kind, required: f.required === true };
  if (f.help) field.help = f.help;
  if (f.placeholder) field.placeholder = f.placeholder;
  const choice = ["radio", "checkbox", "select"].includes(f.kind);
  if (choice) {
    const options = validateOptions(f.options);
    if (!options) return null;
    field.options = options;
  } else if ("options" in f) return null;
  const ranged = ["number", "slider", "date"].includes(f.kind);
  if (!ranged && ("min" in f || "max" in f || "step" in f)) return null;
  if (f.kind === "date") {
    if ("step" in f) return null;
    if ("min" in f && !isDate(f.min)) return null;
    if ("max" in f && !isDate(f.max)) return null;
    if (f.min && f.max && f.min > f.max) return null;
    if (f.min) field.min = f.min;
    if (f.max) field.max = f.max;
  } else if (ranged) {
    for (const k of ["min", "max", "step"]) if (k in f && !num(f[k])) return null;
    if ("step" in f && f.step <= 0) return null;
    if (f.kind === "slider" && (!("min" in f) || !("max" in f))) return null;
    if ("min" in f && "max" in f && f.min > f.max) return null;
    for (const k of ["min", "max", "step"]) if (k in f) field[k] = f[k];
  }
  if ("default" in f) {
    const d = f.default;
    let ok = false;
    switch (f.kind) {
      case "text":
      case "textarea":
        ok = str(d, 4000, true);
        break;
      case "number":
      case "slider":
        ok = num(d) && (field.min === undefined || d >= field.min) && (field.max === undefined || d <= field.max);
        break;
      case "date":
        ok = isDate(d) && (!field.min || d >= field.min) && (!field.max || d <= field.max);
        break;
      case "toggle":
        ok = typeof d === "boolean";
        break;
      case "radio":
      case "select":
        ok = typeof d === "string" && field.options.some((o) => o.value === d);
        break;
      case "checkbox":
        ok =
          Array.isArray(d) &&
          d.every((x) => typeof x === "string" && field.options.some((o) => o.value === x)) &&
          uniq(d);
        break;
    }
    if (!ok) return null;
    field.default = Array.isArray(d) ? [...d] : d;
  }
  return field;
}

function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length > 6) return null;
  const out = [];
  for (const a of actions) {
    if (!isPlain(a) || !onlyKeys(a, ["id", "label", "style"])) return null;
    if (typeof a.id !== "string" || !ID.test(a.id) || !str(a.label, 80)) return null;
    if ("style" in a && !["primary", "secondary"].includes(a.style)) return null;
    out.push({ id: a.id, label: a.label.trim(), style: a.style === "primary" ? "primary" : "secondary" });
  }
  return uniq(out.map((a) => a.id)) ? out : null;
}

function validateForm(v) {
  if (!onlyKeys(v, ["version", "type", "id", "title", "description", "fields", "submitLabel", "actions"]))
    return null;
  if ("description" in v && !str(v.description, 1000)) return null;
  if ("submitLabel" in v && !str(v.submitLabel, 60)) return null;
  const rawFields = v.fields ?? [];
  if (!Array.isArray(rawFields) || rawFields.length > 20) return null;
  const fields = [];
  for (const f of rawFields) {
    const field = validateField(f);
    if (!field) return null;
    fields.push(field);
  }
  if (!uniq(fields.map((f) => f.id))) return null;
  const actions = "actions" in v ? validateActions(v.actions) : [];
  if (!actions) return null;
  if (fields.length === 0 && actions.length === 0) return null;
  return {
    version: 1,
    type: "form",
    id: v.id,
    title: v.title.trim(),
    ...(v.description ? { description: v.description } : {}),
    fields,
    ...(v.submitLabel ? { submitLabel: v.submitLabel.trim() } : {}),
    actions,
  };
}

function validateTable(v) {
  if (!onlyKeys(v, ["version", "type", "id", "title", "description", "columns", "rows", "selection", "submitLabel"]))
    return null;
  if ("description" in v && !str(v.description, 1000)) return null;
  if ("submitLabel" in v && !str(v.submitLabel, 60)) return null;
  if (!Array.isArray(v.columns) || v.columns.length < 1 || v.columns.length > 8) return null;
  const columns = [];
  for (const c of v.columns) {
    if (!isPlain(c) || !onlyKeys(c, ["id", "label", "align"])) return null;
    if (typeof c.id !== "string" || !ID.test(c.id) || !str(c.label, 120)) return null;
    if ("align" in c && !["start", "end"].includes(c.align)) return null;
    columns.push({ id: c.id, label: c.label.trim(), align: c.align === "end" ? "end" : "start" });
  }
  if (!uniq(columns.map((c) => c.id))) return null;
  if (!Array.isArray(v.rows) || v.rows.length < 1 || v.rows.length > 50) return null;
  const rows = [];
  for (const r of v.rows) {
    if (!isPlain(r) || !onlyKeys(r, ["id", "cells"])) return null;
    if (typeof r.id !== "string" || !ID.test(r.id)) return null;
    if (!Array.isArray(r.cells) || r.cells.length !== columns.length) return null;
    if (!r.cells.every((c) => str(c, 500, true) || num(c))) return null;
    rows.push({ id: r.id, cells: r.cells.map((c) => (typeof c === "number" ? c : String(c))) });
  }
  if (!uniq(rows.map((r) => r.id))) return null;
  const selection = v.selection ?? "none";
  if (!["none", "single", "multiple"].includes(selection)) return null;
  return {
    version: 1,
    type: "table",
    id: v.id,
    title: v.title.trim(),
    ...(v.description ? { description: v.description } : {}),
    columns,
    rows,
    selection,
    ...(v.submitLabel ? { submitLabel: v.submitLabel.trim() } : {}),
  };
}

/** Returns a normalized copy, or null when anything is outside the schema. */
export function validateInteractiveBlock(value) {
  try {
    if (!isPlain(value) || value.version !== 1) return null;
    if (typeof value.id !== "string" || !ID.test(value.id) || !str(value.title, 160)) return null;
    if (value.type === "form") return validateForm(value);
    if (value.type === "table") return validateTable(value);
    return null;
  } catch {
    return null;
  }
}

/** Initial values for a form, from defaults. */
export function initialFormValues(block) {
  const values = {};
  for (const f of block.fields) {
    if ("default" in f) values[f.id] = Array.isArray(f.default) ? [...f.default] : f.default;
    else if (f.kind === "checkbox") values[f.id] = [];
    else if (f.kind === "toggle") values[f.id] = false;
    else if (f.kind === "slider") values[f.id] = f.min;
    else values[f.id] = "";
  }
  return values;
}

/** Returns { fieldId: message } for every invalid field. */
export function validateFormValues(block, values) {
  const errors = {};
  for (const f of block.fields) {
    const v = values?.[f.id];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required && f.kind !== "toggle") errors[f.id] = `${f.label} is required.`;
      continue;
    }
    if (f.kind === "number" || f.kind === "slider") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) errors[f.id] = `${f.label} must be a number.`;
      else if (f.min !== undefined && n < f.min) errors[f.id] = `${f.label} must be at least ${f.min}.`;
      else if (f.max !== undefined && n > f.max) errors[f.id] = `${f.label} must be at most ${f.max}.`;
    } else if (f.kind === "date") {
      if (!isDate(v)) errors[f.id] = `${f.label} must be a valid date.`;
      else if (f.min && v < f.min) errors[f.id] = `${f.label} must be on or after ${f.min}.`;
      else if (f.max && v > f.max) errors[f.id] = `${f.label} must be on or before ${f.max}.`;
    } else if (f.kind === "radio" || f.kind === "select") {
      if (!f.options.some((o) => o.value === v)) errors[f.id] = `Choose a valid ${f.label}.`;
    } else if (f.kind === "checkbox") {
      if (!Array.isArray(v) || !v.every((x) => f.options.some((o) => o.value === x)))
        errors[f.id] = `Choose valid ${f.label} options.`;
    } else if (f.kind === "text" || f.kind === "textarea") {
      if (typeof v !== "string" || v.length > 4000) errors[f.id] = `${f.label} is too long.`;
    }
  }
  return errors;
}

const labelOf = (field, value) => field.options?.find((o) => o.value === value)?.label ?? value;

/** Human-readable conversation message describing a submission. */
export function formatSubmission(block, submission) {
  const lines = [block.title];
  if (block.type === "form") {
    if (submission.action) {
      const action = block.actions.find((a) => a.id === submission.action);
      lines.push(`Selected: ${action ? action.label : submission.action}`);
    }
    for (const f of block.fields) {
      const v = submission.values?.[f.id];
      let shown;
      if (f.kind === "toggle") shown = v ? "Yes" : "No";
      else if (Array.isArray(v)) shown = v.length ? v.map((x) => labelOf(f, x)).join(", ") : "";
      else shown = v === undefined || v === "" ? "" : String(labelOf(f, String(v)));
      if (shown) lines.push(`- ${f.label}: ${shown}`);
    }
  } else {
    const picked = block.rows.filter((r) => submission.selected?.includes(r.id));
    lines.push(picked.length ? "Selected:" : "Selected: none");
    for (const r of picked) lines.push(`- ${r.cells.join(" · ")}`);
  }
  return lines.join("\n");
}

/** Split text into markdown and validated kova-interactive blocks. Invalid blocks stay text. */
export function splitInteractiveContent(value) {
  if (typeof value !== "string" || !value) return [];
  if (value.length > MAX_MESSAGE_CHARS || !value.includes("kova-interactive"))
    return [{ kind: "text", text: value }];
  const parts = [];
  const re = /(^|\n) {0,3}(`{3,})kova-interactive[ \t]*\n([\s\S]*?)\n {0,3}\2[ \t]*(?=\n|$)/g;
  let last = 0;
  let count = 0;
  let m;
  while ((m = re.exec(value)) && count < MAX_BLOCKS) {
    const start = m.index + m[1].length;
    const body = m[3];
    if (body.length > MAX_BLOCK_CHARS) continue;
    let block = null;
    try {
      block = validateInteractiveBlock(JSON.parse(body));
    } catch {
      block = null;
    }
    if (!block) continue;
    if (start > last) parts.push({ kind: "text", text: value.slice(last, start) });
    parts.push({ kind: "interactive", block, index: count });
    last = m.index + m[0].length;
    count += 1;
  }
  if (last < value.length) parts.push({ kind: "text", text: value.slice(last) });
  return parts;
}

export const INTERACTIVE_UI_INSTRUCTIONS = `When you genuinely need structured input from the user (choices, preferences, a short form, a date, a range, or picking rows from options), you may emit a fenced \`\`\`kova-interactive JSON block. Prefer plain text otherwise. Exact version-1 shapes only:
form: {"version":1,"type":"form","id":"trip-prefs","title":"Trip preferences","description":"optional","fields":[{"id":"budget","label":"Budget","kind":"slider","min":0,"max":5000,"step":100,"default":1500},{"id":"style","label":"Style","kind":"radio","required":true,"options":[{"value":"relax","label":"Relaxed"},{"value":"adventure","label":"Adventure"}]},{"id":"start","label":"Start date","kind":"date","min":"2026-01-01"}],"submitLabel":"Send","actions":[{"id":"skip","label":"Skip","style":"secondary"}]}
field kinds: text, textarea, number, radio, checkbox, select, slider, date, toggle. radio/checkbox/select need options (max 24). slider needs min and max. Optional keys: required, help, placeholder, default, min, max, step. A form may have only actions (quick-reply buttons, max 6) and no fields.
table: {"version":1,"type":"table","id":"plans","title":"Compare plans","columns":[{"id":"name","label":"Plan"},{"id":"price","label":"Price","align":"end"}],"rows":[{"id":"basic","cells":["Basic","$10"]}],"selection":"single","submitLabel":"Choose"} (selection: none, single or multiple; cells are strings or numbers; max 8 columns, 50 rows).
IDs use letters, digits, hyphens or underscores. No HTML, markdown, URLs or code inside the JSON. The user's submission arrives as their next message; never claim an action was performed before it does.`;
