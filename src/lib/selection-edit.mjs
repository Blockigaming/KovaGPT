// Pure helpers for the inline "edit selected text" workflow.
//
// The renderer shows markdown, but every persisted edit must apply to the
// original markdown source. Rather than guess at offsets, we locate the exact
// selected string inside the source and refuse the edit when the mapping is
// ambiguous or malformed. Refusing is always preferable to writing a corrupted
// message back into history.

export const MIN_SELECTION_CHARS = 2;
export const MAX_SELECTION_CHARS = 8_000;
export const MAX_EDIT_INSTRUCTION_CHARS = 2_000;

/** Stable error codes so the UI can show one honest message per failure. */
export const SELECTION_EDIT_ERRORS = Object.freeze({
  empty: "Select some text in the response first.",
  too_short: "Select at least a couple of characters to edit.",
  too_long: `Select ${MAX_SELECTION_CHARS.toLocaleString()} characters or fewer.`,
  not_found: "That selection could not be matched to the original text, so it was not changed.",
  ambiguous:
    "That text appears more than once in this response. Select a longer, unique passage to edit.",
  bad_range: "That selection range is not valid.",
  fence_unbalanced:
    "The rewrite would leave an unbalanced code block, so it was rejected instead of corrupting the response.",
  empty_result: "The rewrite came back empty, so nothing was changed.",
});

export function selectionEditError(code) {
  return new Error(SELECTION_EDIT_ERRORS[code] ?? SELECTION_EDIT_ERRORS.bad_range);
}

function normalizeWhitespace(value) {
  return value.replace(/\r\n?/g, "\n");
}

/**
 * Count unterminated ``` fences. Balanced source has an even count.
 */
export function fenceCount(value) {
  const matches = normalizeWhitespace(value).match(/^\s{0,3}`{3,}/gm);
  return matches ? matches.length : 0;
}

/**
 * Locate a selected string inside the markdown source.
 * Returns { start, end } or throws a typed error.
 */
export function locateSelection(source, selectedText) {
  if (typeof source !== "string" || typeof selectedText !== "string") {
    throw selectionEditError("bad_range");
  }
  const haystack = normalizeWhitespace(source);
  const needle = normalizeWhitespace(selectedText).trim();
  if (!needle) throw selectionEditError("empty");
  if (needle.length < MIN_SELECTION_CHARS) throw selectionEditError("too_short");
  if (needle.length > MAX_SELECTION_CHARS) throw selectionEditError("too_long");

  const first = haystack.indexOf(needle);
  if (first === -1) throw selectionEditError("not_found");
  if (haystack.indexOf(needle, first + 1) !== -1) throw selectionEditError("ambiguous");
  return { start: first, end: first + needle.length };
}

/** Validate an explicit range against the source text. */
export function validateSelectionRange(source, start, end) {
  if (typeof source !== "string") throw selectionEditError("bad_range");
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > source.length ||
    end <= start
  ) {
    throw selectionEditError("bad_range");
  }
  const length = end - start;
  if (length < MIN_SELECTION_CHARS) throw selectionEditError("too_short");
  if (length > MAX_SELECTION_CHARS) throw selectionEditError("too_long");
  return {
    start,
    end,
    prefix: source.slice(0, start),
    selected: source.slice(start, end),
    suffix: source.slice(end),
  };
}

/**
 * Strip the wrappers models habitually add ("Here is the rewrite:", fenced
 * blocks around prose) without touching a selection that legitimately was a
 * fenced block.
 */
export function normalizeRewrite(raw, selected) {
  let value = normalizeWhitespace(typeof raw === "string" ? raw : "").trim();
  if (!value) return "";
  const selectedHadFence = fenceCount(selected ?? "") > 0;
  if (!selectedHadFence) {
    const fenced = /^`{3,}[\w-]*\n([\s\S]*?)\n?`{3,}$/.exec(value);
    if (fenced?.[1] !== undefined) value = fenced[1];
  }
  value = value.replace(/^(here(?:'s| is)[^\n:]{0,60}:)\s*/i, "");
  return value.trim();
}

/**
 * Replace [start, end) with `replacement`, preserving the untouched prefix and
 * suffix exactly. Rejects rewrites that would unbalance code fences.
 */
export function applySelectionEdit(source, start, end, replacement) {
  const range = validateSelectionRange(source, start, end);
  const next = typeof replacement === "string" ? replacement : "";
  if (!next.trim()) throw selectionEditError("empty_result");
  if (fenceCount(range.selected) % 2 !== fenceCount(next) % 2) {
    throw selectionEditError("fence_unbalanced");
  }
  const merged = `${range.prefix}${next}${range.suffix}`;
  if (fenceCount(merged) % 2 !== fenceCount(source) % 2) {
    throw selectionEditError("fence_unbalanced");
  }
  return merged;
}

/** Bounded instruction for the shared /api/write custom action. */
export function buildRewriteInstruction(instruction, selected, context = {}) {
  const trimmed = (typeof instruction === "string" ? instruction : "").trim();
  if (!trimmed) throw new Error("Describe how the selected text should change.");
  const bounded = trimmed.slice(0, MAX_EDIT_INSTRUCTION_CHARS);
  const hadFence = fenceCount(selected ?? "") > 0;
  const parts = [
    `Rewrite ONLY the selected passage from a longer answer. Instruction: ${bounded}`,
    "Return just the replacement passage, with no preamble, no surrounding quotes, and no explanation.",
    hadFence
      ? "The passage contains a fenced code block; keep the fences balanced."
      : "Do not wrap the result in a code fence.",
    "Preserve markdown structure (list markers, table pipes, heading level) that the passage already uses.",
  ];
  if (context.before) parts.push(`Text immediately before (do not repeat it): ${context.before}`);
  if (context.after) parts.push(`Text immediately after (do not repeat it): ${context.after}`);
  return parts.join("\n");
}

/** Small surrounding window so the model keeps tone without echoing context. */
export function selectionContext(source, start, end, window = 400) {
  return {
    before: source.slice(Math.max(0, start - window), start),
    after: source.slice(end, end + window),
  };
}

/**
 * Map an HTTP failure onto a single honest sentence. Never claims success.
 */
export function describeRewriteFailure(status, code) {
  if (status === 0) return "You appear to be offline. The response was not changed.";
  if (status === 401) return "Your session expired. Sign in again to rewrite with Kova.";
  if (status === 403) return "This account cannot use Kova rewrites.";
  if (status === 429) return "You have hit today's rewrite limit. Try again later.";
  if (status === 413) return "That selection is too large to rewrite.";
  if (status === 503 || code === "ai_provider_unavailable") {
    return "Kova's model is unavailable right now. Nothing was changed.";
  }
  if (status >= 500) return "The rewrite failed upstream. Nothing was changed.";
  return "The rewrite could not be completed. Nothing was changed.";
}
