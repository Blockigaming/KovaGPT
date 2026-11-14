import { responseFences } from "./response-fences.mjs";

// Model-generated interactive response components ("kova-interactive" fences).
// A closed, strictly validated data schema: React renders every string as text,
// nothing here can carry HTML, scripts, URLs to navigate, or event handlers.

const MAX_MESSAGE_CHARS = 128 * 1024;
const MAX_BLOCK_CHARS = 32 * 1024;
const MAX_BLOCKS = 6;
export const INTELLIGENT_INTERFACE_NAME = "Intelligent Interface";
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
  const keys = [
    "id",
    "label",
    "kind",
    "required",
    "help",
    "placeholder",
    "options",
    "min",
    "max",
    "step",
    "default",
  ];
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
        ok =
          num(d) &&
          (field.min === undefined || d >= field.min) &&
          (field.max === undefined || d <= field.max);
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
    out.push({
      id: a.id,
      label: a.label.trim(),
      style: a.style === "primary" ? "primary" : "secondary",
    });
  }
  return uniq(out.map((a) => a.id)) ? out : null;
}

function validateForm(v) {
  if (
    !onlyKeys(v, [
      "version",
      "type",
      "id",
      "title",
      "description",
      "fields",
      "submitLabel",
      "actions",
    ])
  )
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
  if (
    !onlyKeys(v, [
      "version",
      "type",
      "id",
      "title",
      "description",
      "columns",
      "rows",
      "selection",
      "submitLabel",
    ])
  )
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

function validateStudyBlock(value) {
  if (
    !onlyKeys(value, [
      "version",
      "type",
      "id",
      "title",
      "description",
      "cards",
      "adaptive",
      "secondsPerQuestion",
    ])
  )
    return null;
  if ("description" in value && !str(value.description, 800)) return null;
  if (!Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 30) return null;
  const quiz = value.type === "quiz";
  if ("adaptive" in value && typeof value.adaptive !== "boolean") return null;
  if (
    "secondsPerQuestion" in value &&
    (!quiz ||
      !Number.isInteger(value.secondsPerQuestion) ||
      value.secondsPerQuestion < 5 ||
      value.secondsPerQuestion > 600)
  )
    return null;
  const cards = [];
  for (const card of value.cards) {
    if (!isPlain(card) || !str(card.front, 600) || !str(card.back, 1200)) return null;
    if (!quiz) {
      if (!onlyKeys(card, ["front", "back"])) return null;
      cards.push({ front: card.front, back: card.back });
      continue;
    }
    if (
      !onlyKeys(card, ["front", "back", "kind", "options", "answer", "hint", "tolerance", "items"])
    )
      return null;
    if ("hint" in card && !str(card.hint, 400)) return null;
    const shared = { front: card.front, back: card.back, hint: card.hint };
    const kind = card.kind ?? "choice";
    if (kind !== "matching" && "items" in card) return null;
    if (kind === "matching") {
      if ("tolerance" in card) return null;
      const options = validateOptions(card.options);
      const items = validateOptions(card.items);
      if (
        !options ||
        options.length < 2 ||
        !items ||
        items.length < 2 ||
        !Array.isArray(card.answer) ||
        card.answer.length !== items.length ||
        !card.answer.every((answer) => options.some(({ value }) => value === answer))
      )
        return null;
      cards.push({ ...shared, kind, options, items, answer: [...card.answer] });
    } else if (kind === "choice" || kind === "multiple" || kind === "ordering") {
      if ("tolerance" in card) return null;
      const options = validateOptions(card.options);
      const answers = kind === "choice" ? [card.answer] : card.answer;
      if (
        !options ||
        options.length < 2 ||
        !Array.isArray(answers) ||
        !answers.length ||
        !uniq(answers) ||
        (kind === "ordering" && answers.length !== options.length) ||
        !answers.every((answer) => options.some(({ value }) => value === answer))
      )
        return null;
      cards.push({ ...shared, kind, options, answer: card.answer });
    } else if (kind === "number") {
      if (
        "options" in card ||
        !num(card.answer) ||
        ("tolerance" in card && (!num(card.tolerance) || card.tolerance < 0))
      )
        return null;
      cards.push({ ...shared, kind, answer: card.answer, tolerance: card.tolerance ?? 0 });
    } else if (kind === "short") {
      if (
        "options" in card ||
        "tolerance" in card ||
        !Array.isArray(card.answer) ||
        card.answer.length < 1 ||
        card.answer.length > 12 ||
        !card.answer.every((answer) => str(answer, 200))
      )
        return null;
      cards.push({ ...shared, kind, answer: card.answer.map((answer) => answer.trim()) });
    } else return null;
  }
  return {
    version: 1,
    type: value.type,
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    ...(value.adaptive ? { adaptive: true } : {}),
    ...(value.secondsPerQuestion ? { secondsPerQuestion: value.secondsPerQuestion } : {}),
    cards,
  };
}

const simulationModels = {
  linear: ["slope", "intercept", "x"],
  quadratic: ["a", "b", "c", "x"],
  rectangle: ["width", "height"],
  "compound-interest": ["principal", "rate", "years"],
};

function validateSimulation(value) {
  if (!onlyKeys(value, ["version", "type", "id", "title", "description", "model", "inputs"]))
    return null;
  if ("description" in value && !str(value.description, 800)) return null;
  if (!Object.hasOwn(simulationModels, value.model) || !isPlain(value.inputs)) return null;
  const keys = simulationModels[value.model];
  if (!onlyKeys(value.inputs, keys)) return null;
  const inputs = {};
  for (const key of keys) {
    const range = value.inputs[key];
    if (!isPlain(range) || !onlyKeys(range, ["min", "max", "step", "value"])) return null;
    const { min, max, step, value: initial } = range;
    if (![min, max, step, initial].every(num) || min < -1e6 || max > 1e6) return null;
    if (min >= max || step <= 0 || step > max - min || initial < min || initial > max) return null;
    const offset = (initial - min) / step;
    if ((max - min) / step > 1e5 || Math.abs(offset - Math.round(offset)) > 1e-7) return null;
    if (["width", "height", "principal", "years"].includes(key) && min < 0) return null;
    if (key === "rate" && (min <= -100 || max > 100)) return null;
    if (key === "years" && (max > 100 || ![min, max, step, initial].every(Number.isInteger)))
      return null;
    inputs[key] = { min, max, step, value: initial };
  }
  return {
    version: 1,
    type: "simulation",
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    model: value.model,
    inputs,
  };
}

function validateDiagram(value) {
  if (!onlyKeys(value, ["version", "type", "id", "title", "description", "nodes", "edges"]))
    return null;
  if ("description" in value && !str(value.description, 800)) return null;
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length < 1 ||
    value.nodes.length > 24 ||
    !Array.isArray(value.edges) ||
    value.edges.length > 60
  )
    return null;
  const nodes = [];
  for (const node of value.nodes) {
    if (
      !isPlain(node) ||
      !onlyKeys(node, ["id", "label", "x", "y", "shape"]) ||
      typeof node.id !== "string" ||
      !ID.test(node.id) ||
      !str(node.label, 26) ||
      ![node.x, node.y].every((n) => num(n) && n >= 0 && n <= 100) ||
      !["box", "decision", "terminal"].includes(node.shape ?? "box")
    )
      return null;
    nodes.push({
      id: node.id,
      label: node.label.trim(),
      x: node.x,
      y: node.y,
      shape: node.shape ?? "box",
    });
  }
  if (!uniq(nodes.map(({ id }) => id))) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  for (const edge of value.edges) {
    if (
      !isPlain(edge) ||
      !onlyKeys(edge, ["from", "to", "label"]) ||
      !byId.has(edge.from) ||
      !byId.has(edge.to) ||
      edge.from === edge.to ||
      ("label" in edge && !str(edge.label, 48))
    )
      return null;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from.x === to.x && from.y === to.y) return null;
    edges.push({ from: edge.from, to: edge.to, label: edge.label });
  }
  if (!uniq(edges.map(({ from, to }) => from + ":" + to))) return null;
  return {
    version: 1,
    type: "diagram",
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    nodes,
    edges,
  };
}

function validatePattern(value) {
  if (!onlyKeys(value, ["version", "type", "id", "title", "description", "pattern", "colors"]))
    return null;
  if ("description" in value && !str(value.description, 800)) return null;
  if (
    !["stripes", "dots", "checks", "gradient"].includes(value.pattern) ||
    !Array.isArray(value.colors) ||
    value.colors.length !== 2 ||
    !value.colors.every((color) => typeof color === "string" && /^#[a-f0-9]{6}$/i.test(color))
  )
    return null;
  return {
    version: 1,
    type: "pattern",
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    pattern: value.pattern,
    colors: [...value.colors],
  };
}

function validateFileBundle(value) {
  if (!onlyKeys(value, ["version", "type", "id", "title", "description", "files"])) return null;
  if ("description" in value && !str(value.description, 800)) return null;
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 12) return null;
  const files = [];
  for (const file of value.files) {
    if (
      !isPlain(file) ||
      !onlyKeys(file, ["name", "content"]) ||
      typeof file.name !== "string" ||
      !/^[a-z0-9][a-z0-9 _.-]{0,79}\.(?:txt|md|csv|tsv|json|yaml|yml|toml|ipynb)$/i.test(
        file.name,
      ) ||
      !str(file.content, 24_000, true)
    )
      return null;
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[. ]|$)/i.test(file.name)) return null;
    files.push({ name: file.name, content: file.content });
  }
  if (!uniq(files.map((file) => file.name.toLowerCase()))) return null;
  return {
    version: 1,
    type: "files",
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    files,
  };
}

/** Returns a normalized copy, or null when anything is outside the schema. */
export function validateInteractiveBlock(value) {
  try {
    if (!isPlain(value) || value.version !== 1) return null;
    if (typeof value.id !== "string" || !ID.test(value.id) || !str(value.title, 160)) return null;
    if (value.type === "form") return validateForm(value);
    if (value.type === "table") return validateTable(value);
    if (value.type === "simulation") return validateSimulation(value);
    if (value.type === "diagram") return validateDiagram(value);
    if (value.type === "pattern") return validatePattern(value);
    if (value.type === "files") return validateFileBundle(value);
    if (value.type === "quiz" || value.type === "flashcards") return validateStudyBlock(value);
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
      else if (f.min !== undefined && n < f.min)
        errors[f.id] = `${f.label} must be at least ${f.min}.`;
      else if (f.max !== undefined && n > f.max)
        errors[f.id] = `${f.label} must be at most ${f.max}.`;
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
  } else if (block.type === "table") {
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
  let last = 0;
  let count = 0;
  for (const { info, start, body, end } of responseFences(value)) {
    if (count === MAX_BLOCKS) break;
    if (info !== "kova-interactive" || body.length > MAX_BLOCK_CHARS) continue;
    let block = null;
    try {
      block = validateInteractiveBlock(JSON.parse(body));
    } catch {
      block = null;
    }
    if (!block) continue;
    if (start > last) parts.push({ kind: "text", text: value.slice(last, start) });
    parts.push({ kind: "interactive", block, index: count });
    last = end;
    count += 1;
  }
  if (last < value.length) parts.push({ kind: "text", text: value.slice(last) });
  return parts;
}

export const INTERACTIVE_UI_INSTRUCTIONS = `${INTELLIGENT_INTERFACE_NAME}: Answer first. When useful, offer 2-4 task-specific next-step buttons (one primary). Omit generic follow-ups and controls on complete simple answers. Use fields or selectable tables only for input needed to continue. Give blocks task-specific titles. Use quiz for objective practice with immediate local feedback and flashcards for recall practice. Use a form for open-ended answers that need a follow-up from Kova. For quiz cards, optional kind is choice (default, one option ID), multiple (option IDs array), number (numeric answer, optional numeric tolerance), or short (array of accepted strings). For ordering cards, include options in scrambled order and answer as an array of all option IDs in correct order. For matching or classification, include items and options (each an array of value/label pairs), and answer as an array containing the correct option ID for each item in order. Set deck-level adaptive to true to offer targeted review of missed items. Quizzes can include secondsPerQuestion (5–600) for timed practice that the learner starts explicitly. Use exactly two options for true/false or yes/no. Emit fenced \`\`\`kova-interactive JSON with exact version-1 shapes:
next steps: {"version":1,"type":"form","id":"next","title":"Next step","actions":[{"id":"plan","label":"Build my plan","style":"primary"},{"id":"compare","label":"Compare options","style":"secondary"}]}
form: {"version":1,"type":"form","id":"prefs","title":"Your preferences","fields":[{"id":"style","label":"Style","kind":"radio","required":true,"options":[{"value":"relax","label":"Relaxed"},{"value":"adventure","label":"Adventure"}]}],"submitLabel":"Build my plan"}
field kinds: text, textarea, number, radio, checkbox, select, slider, date, toggle. radio/checkbox/select require options (max 24); slider requires min/max. Optional: required, help, placeholder, default, min, max, step. Forms may contain only actions (max 6).
table: {"version":1,"type":"table","id":"plans","title":"Compare plans","columns":[{"id":"name","label":"Plan"},{"id":"price","label":"Price","align":"end"}],"rows":[{"id":"basic","cells":["Basic","$10"]}],"selection":"single","submitLabel":"Choose"} (selection: none, single or multiple; cells are strings or numbers; max 8 columns, 50 rows).
quiz: {"version":1,"type":"quiz","id":"practice","title":"Practice","cards":[{"front":"What is 2 + 2?","options":[{"value":"a","label":"3"},{"value":"b","label":"4"}],"answer":"b","back":"Adding two and two gives four.","hint":"Count two pairs."}]}
flashcards: {"version":1,"type":"flashcards","id":"recall","title":"Recall","cards":[{"front":"What is the term for stored energy?","back":"Potential energy."}]}
simulation: {"version":1,"type":"simulation","id":"area","title":"Explore rectangle area","model":"rectangle","inputs":{"width":{"min":1,"max":20,"step":1,"value":5},"height":{"min":1,"max":20,"step":1,"value":4}}}. Other models: linear (slope, intercept, x), quadratic (a, b, c, x), compound-interest (principal, rate as a percent, whole years). Include all required inputs. Use local simulations for these formulas only.
diagram: {"version":1,"type":"diagram","id":"flow","title":"Process flow","nodes":[{"id":"start","label":"Start","x":20,"y":20,"shape":"terminal"},{"id":"check","label":"Review","x":65,"y":75,"shape":"decision"}],"edges":[{"from":"start","to":"check","label":"Next"}]}. Coordinates run 0–100; leave room around nodes and edge labels. Shape is box, decision or terminal. Use for flowcharts, trees, system diagrams and concept maps.
pattern: {"version":1,"type":"pattern","id":"palette","title":"Pattern preview","pattern":"stripes","colors":["#2f61a8","#eff4ff"]}. Pattern is stripes, dots, checks or gradient.
files: {"version":1,"type":"files","id":"notes","title":"Research notes","files":[{"name":"notes.md","content":"# Notes"}]}. Use for actual text, Markdown, CSV, TSV, JSON, YAML, TOML or notebook output; no paths or external URLs. A user can preview or download individual files or a ZIP. Do not claim files have already been downloaded.
IDs: letters/digits/hyphens/underscores. No HTML, markdown, URLs or code. Form and selectable-table submissions send the next user message; quizzes, flashcards, simulations, diagrams and pattern previews work locally; they do not execute external actions, grant access, or prove success.`;
